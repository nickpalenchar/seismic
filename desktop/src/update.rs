// Updates of the app from GitHub Releases, through Tauri's updater: the endpoint and the public key
// of Seismic's own key pair are in tauri.conf.json, and scripts/build-app.ts signs what a release
// holds with the private one.
//
// - At start and every six hours the shell asks for latest.json of the newest release. A newer
//   version is downloaded and its signature checked at once, so that installing it later takes
//   seconds, not a download.
// - Every few seconds the shell tells the server about it (`POST /api/app-update`): the bar shows
//   it, and the owner installs it from there. That goes as a restart for new code goes: the server
//   waits for the workers (and the owner's video or dictation) and ends with EXIT; the shell then
//   installs the update and starts the app again, whose server resumes the workers.
// - A .deb is not replaced by the app (dpkg needs root): the bar offers the release to download.
// - Only for an Seismic the app started in this run, whose end it sees. An Seismic from a checkout
//   updates itself from its checkout, and so does a shell installed from one (`bun run app install`,
//   which compiles in the version of desktop/ it was built from, SEISMIC_BUILT_TREE): every minute it
//   looks at desktop/ on the checkout's HEAD, and once that is another, the checkout's scripts/app.ts
//   builds the shell and installs it in this one's place. The shell then tells the server it started
//   of it as of an update, which the server installs without asking, as it restarts for new code;
//   nothing is left to install then but starting again. A server it did not start (a terminal's)
//   runs on, and the shell starts again by itself (`start_again`). A build that failed (its output
//   is in app-build.log in the home) is tried again for the next change of app/.
// - SEISMIC_UPDATE_EVERY=<seconds> asks that often instead (scripts/check-update.ts).

mod workspaces;

use std::{
  fs, io,
  path::Path,
  process::{Command, Stdio},
  sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
  thread,
  time::Duration,
};

use serde_json::json;
use tauri::{utils::config::BundleType, AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::window::placed::{self, Placed};
use crate::{desks::{local_view, rebuild_revision, RebuildRevision}, no_window, post, Seismic};
use uuid::Uuid;

/// The exit code with which the server asks the shell to install the update (src/server/selfUpdate.ts).
pub const EXIT: i32 = 77;
const EVERY: Duration = Duration::from_secs(6 * 3600);
/// After a check that failed (offline, say).
const AGAIN: Duration = Duration::from_secs(30 * 60);
/// The switch for checking for releases (docs/release.md), with `UPDATES_ENABLED` in src/server/appUpdate.ts.
const CHECK_RELEASES: bool = true;
/// Where a .deb update is fetched by hand, as the server expects it (`RELEASES` in src/server/appUpdate.ts).
const RELEASES: &str = "https://github.com/nickpalenchar/seismic/releases";

/// A newer version, downloaded and checked; or for a .deb, where to get it.
struct Ready {
  update: Update,
  bytes: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct Updates {
  ready: Mutex<Option<Arc<Ready>>>,
  /// Installed from a checkout: a new build of the shell is in this one's place.
  rebuilt: Mutex<bool>,
  installing: AtomicBool,
  snapshot_deferred: AtomicBool,
}

impl Updates {
  fn installed(&self, release: &Arc<Ready>) {
    let mut ready = self.ready.lock().unwrap();
    if ready.as_ref().is_some_and(|r| Arc::ptr_eq(r, release)) {
      ready.take();
    }
    // A successful installer which returns has replaced the shell. If recapture fails,
    // retry the relaunch without running the same installer again.
    *self.rebuilt.lock().unwrap() = true;
  }
}

fn deb() -> bool {
  matches!(tauri::utils::platform::bundle_type(), Some(BundleType::Deb))
}

pub fn start(app: &AppHandle, seismic: Arc<Seismic>) -> Arc<Updates> {
  let updates = Arc::new(Updates::default());
  if let Some(checkout) = crate::checkout() {
    if let Some(built) = option_env!("SEISMIC_BUILT_TREE").or(option_env!("OBEYA_BUILT_TREE")).filter(|t| !t.is_empty()) {
      let (home, u) = (crate::home(), updates.clone());
      thread::spawn(move || rebuild(&checkout, built, &home, &u));
    } else if !(cfg!(debug_assertions) && crate::seismic_env("APP_CHECK").is_some()) {
      return updates;
    }
  } else if CHECK_RELEASES {
    check_releases(app, &updates);
  }
  let (a, u) = (app.clone(), updates.clone());
  thread::spawn(move || loop {
    report(&a, &seismic, &u);
    thread::sleep(Duration::from_secs(3));
  });
  updates
}

/// At start and every six hours: a newer release, downloaded.
fn check_releases(app: &AppHandle, updates: &Arc<Updates>) {
  let every = crate::seismic_env("UPDATE_EVERY").and_then(|s| s.into_string().ok()).and_then(|s| s.parse().ok()).map(Duration::from_secs);
  let (a, u) = (app.clone(), updates.clone());
  thread::spawn(move || loop {
    let wait = match check(&a, &u) {
      Ok(()) => every.unwrap_or(EVERY),
      Err(e) => {
        eprintln!("seismic: checking for an update failed: {e}");
        every.unwrap_or(AGAIN)
      }
    };
    thread::sleep(wait);
  });
}

/// Installed from a checkout: builds and installs the shell anew whenever desktop/ on the checkout's
/// HEAD is another than the one it was last built from.
fn rebuild(checkout: &Path, built: &str, home: &Path, updates: &Updates) {
  let mut last = built.to_string();
  loop {
    if let Some(tree) = tree(checkout).filter(|t| *t != last) {
      last = tree;
      let log = home.join("app-build.log");
      let bun = crate::bun();
      let mut cmd = Command::new(&bun);
      cmd
        .arg(checkout.join("scripts").join("app.ts"))
        // compiled into the new build in turn
        .env("SEISMIC_BUN", &bun)
        .env("OBEYA_BUN", &bun)
        .args(["install", "--no-open"])
        .current_dir(checkout)
        .stdin(Stdio::null());
      no_window(&mut cmd);
      let built = fs::File::create(&log)
        .and_then(|f| Ok((f.try_clone()?, f)))
        .and_then(|(out, err)| cmd.stdout(out).stderr(err).status())
        .is_ok_and(|s| s.success());
      if built {
        *updates.rebuilt.lock().unwrap() = true;
      } else {
        eprintln!("seismic: the shell did not build anew, see {}", log.display());
      }
    }
    thread::sleep(Duration::from_secs(60));
  }
}

/// The version of desktop/ on the checkout's HEAD.
fn tree(checkout: &Path) -> Option<String> {
  let mut cmd = Command::new("git");
  cmd.arg("-C").arg(checkout).args(["rev-parse", "HEAD:desktop"]).stdin(Stdio::null()).stderr(Stdio::null());
  no_window(&mut cmd);
  let out = cmd.output().ok()?;
  let tree = String::from_utf8_lossy(&out.stdout).trim().to_string();
  (out.status.success() && !tree.is_empty()).then_some(tree)
}

/// Asks for a newer version and downloads it; one downloaded already is not fetched again.
fn check(app: &AppHandle, updates: &Updates) -> Result<(), String> {
  let updater = app.updater().map_err(|e| e.to_string())?;
  let Some(update) = tauri::async_runtime::block_on(updater.check()).map_err(|e| e.to_string())? else {
    return Ok(());
  };
  if updates.ready.lock().unwrap().as_ref().is_some_and(|r| r.update.version == update.version) {
    return Ok(());
  }
  let bytes = if deb() {
    None
  } else {
    Some(tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).map_err(|e| e.to_string())?)
  };
  *updates.ready.lock().unwrap() = Some(Arc::new(Ready { update, bytes }));
  Ok(())
}

/// Tells the server of the version that is ready, while it is one the app started in this run. A
/// new build of the shell where the server runs on without it (started from a terminal) starts
/// again by itself (`start_again`).
fn report(app: &AppHandle, seismic: &Seismic, updates: &Updates) {
  let port = seismic.port.load(Ordering::SeqCst);
  if port == 0 || seismic.attaching.load(Ordering::SeqCst) || seismic.stopping.load(Ordering::SeqCst) || updates.installing.load(Ordering::SeqCst) {
    return;
  }
  #[cfg(debug_assertions)]
  if crate::seismic_env("APP_CHECK").is_some() && fs::remove_file(crate::home().join("check-queue-rebuild")).is_ok() {
    *updates.rebuilt.lock().unwrap() = true;
  }
  if !seismic.child.load(Ordering::SeqCst) {
    if *updates.rebuilt.lock().unwrap() {
      if let Err(error) = start_again(app, port) {
        defer_snapshot(app, updates, &error, "The update will retry when Seismic can save the windows.");
      }
    }
    return;
  }
  let body = match updates.ready.lock().unwrap().as_deref() {
    None if *updates.rebuilt.lock().unwrap() => json!({ "rebuilt": true }),
    None => return,
    Some(Ready { update, bytes }) => json!({
      "version": update.version,
      "notes": update.body,
      "date": update.date.map(|d| d.unix_timestamp() * 1000),
      "download": bytes.is_none().then(|| format!("{RELEASES}/tag/v{}", update.version)),
    }),
  };
  // The local server can defer for its own activity. Check the remote pages before asking it
  // to stop, and again once it has stopped, since workers may take time to finish.
  if body["rebuilt"] != true || (retry_snapshot_ready(app, updates) && workspaces::ready(app, false).is_some()) {
    post(port, "/api/app-update", &body);
  }
}

/// A new build of the shell is in place, and the server runs on without it: it starts again once the
/// owner neither dictates nor watches a video (as the server's restart waits for them, which says
/// so) and its window is hidden or in front, after the page handed over what a reload keeps
/// (src/ui/api.ts, `handOver`), or did not within a few seconds (a page that does not know how).
fn start_again(app: &AppHandle, port: u16) -> io::Result<()> {
  let ask = |kept: &str| post(port, "/api/app-rebuilt", &json!({ "kept": kept }));
  let now = |a: &Option<serde_json::Value>| a.as_ref().is_some_and(|a| a["now"] == true);
  if !now(&ask("")) || RebuildWindow::current(app).is_none() || workspaces::ready(app, false).is_none() {
    return Ok(());
  }
  let token = format!("{}", crate::now_ms());
  if let Some(w) = local_view(app) {
    let _ = w.eval(format!("window.seismicHandOver?.({token:?})"));
  }
  for _ in 0..25 {
    thread::sleep(Duration::from_millis(200));
    let answer = ask(&token);
    if answer.as_ref().is_some_and(|a| a["kept"] == true) {
      break;
    }
  }
  // the owner may have begun to speak meanwhile; what was handed over waits for the next try
  if !now(&ask("")) || RebuildWindow::current(app).is_none() {
    return Ok(());
  }
  rebuild_after_handover(
    || {
      let Some(revision) = rebuild_revision(app) else { return Ok(None) };
      Ok(capture_at(app, true, revision.draft_generation)?.map(|windows| (windows, revision)))
    },
    |windows| placed::publish_rebuild(&crate::home(), windows),
    || now(&ask("")),
    |revision| {
      if rebuild_revision(app) != Some(revision) {
        return Ok(None);
      }
      let Some((drafts, hold)) = workspaces::hold_for_rebuild(app) else { return Ok(None) };
      let Some(latest) = crate::desks::placed(app, revision.draft_generation, drafts)? else { return Ok(None) };
      Ok(Some((latest, hold)))
    },
    |commit| tauri::async_runtime::block_on(crate::desks::on_ui(app.clone(), move |app| Ok(commit(app)))).map_err(io::Error::other),
    move |app| {
      let seismic = app.state::<Arc<Seismic>>();
      if seismic.stopping.load(Ordering::SeqCst)
        || seismic.attaching.load(Ordering::SeqCst)
        || seismic.child.load(Ordering::SeqCst)
        || seismic.port.load(Ordering::SeqCst) != port
      {
        return None;
      }
      Some((rebuild_revision(app)?, RebuildWindow::current(app)?))
    },
    |app, ticket, windows, hold| {
      if let Some(hold) = hold {
        hold.keep_until_exit();
      }
      crate::relaunch(app, &app.state::<Arc<Seismic>>(), windows, Some(ticket));
    },
  )
}

#[derive(Debug, PartialEq, Eq)]
enum RebuildWindow {
  Hidden,
  Foreground,
}

impl RebuildWindow {
  fn eligible(minimized: bool, visible: bool, focused: bool) -> Option<Self> {
    match (minimized, visible, focused) {
      (false, false, _) => Some(Self::Hidden),
      (false, true, true) => Some(Self::Foreground),
      _ => None,
    }
  }

  fn current(app: &AppHandle) -> Option<Self> {
    let w = crate::main_window(app)?;
    let minimized = w.is_minimized().ok()?;
    let visible = w.is_visible().ok()?;
    let focused = w.is_focused().ok()?;
    // Tauri checks the key window. A foreground restart also needs the app itself active.
    #[cfg(target_os = "macos")]
    let focused = focused && objc2_app_kit::NSRunningApplication::currentApplication().isActive();
    Self::eligible(minimized, visible, focused)
  }
}

type RebuildCommit<T> = Box<dyn FnOnce(&T) -> bool + Send>;

fn same_workspace_snapshot(before: &[Placed], after: &[Placed]) -> bool {
  let (Some(before), Some(after)) = (placed::primary(before), placed::primary(after)) else { return false };
  before.desk == after.desk && before.origin == after.origin && before.next == after.next
    && before.draft_checkpoint == after.draft_checkpoint
    && same_drafts(&before.drafts, &after.drafts)
}

fn same_drafts(before: &[(String, String)], after: &[(String, String)]) -> bool {
  let after = after.iter().map(|(key, value)| (key.as_str(), value)).collect::<std::collections::HashMap<_, _>>();
  before.len() == after.len() && before.iter().all(|(key, value)| {
    let Some(&latest) = after.get(key.as_str()) else { return false };
    if value == latest {
      return true;
    }
    // snapshotSession flushes the kept view state on each read, renewing its
    // timestamp even when the text fields and everything else stayed the same.
    if key.starts_with("seismic-kept-") {
      let state = |text: &str| {
        let mut view = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(text).ok()?;
        view.remove("at");
        Some(view)
      };
      return state(value).is_some_and(|view| Some(view) == state(latest));
    }
    false
  })
}

fn rebuild_after_handover<T, H: Send + 'static>(
  capture: impl FnOnce() -> io::Result<Option<(Vec<Placed>, RebuildRevision)>>,
  publish: impl FnOnce(&[Placed]) -> io::Result<placed::RebuildSnapshot>,
  local_idle: impl FnOnce() -> bool,
  verify: impl FnOnce(RebuildRevision) -> io::Result<Option<(Vec<Placed>, H)>>,
  on_ui: impl FnOnce(RebuildCommit<T>) -> io::Result<bool>,
  current: impl FnOnce(&T) -> Option<(RebuildRevision, RebuildWindow)> + Send + 'static,
  relaunch: impl FnOnce(&T, Uuid, &[Placed], H) + Send + 'static,
) -> io::Result<()> {
  let Some((windows, revision)) = capture()? else { return Ok(()) };
  let Some(captured) = placed::primary(&windows).and_then(|p| RebuildWindow::eligible(p.minimized, p.visible, p.focused)) else {
    return Ok(());
  };
  let snapshot = publish(&windows)?;
  if !local_idle() {
    return Ok(());
  }
  let Some((latest, hold)) = verify(revision)? else { return Ok(()) };
  if !same_workspace_snapshot(&windows, &latest) {
    return Ok(());
  }
  // A close on macOS hides the window. Both states permit a rebuild, but each needs
  // different startup activation. Check the workspace and presentation on the event
  // thread after disk publication and the server request. Only relaunch uses the ticket.
  let ticket = snapshot.ticket();
  if on_ui(Box::new(move |ui| {
    if current(ui) != Some((revision, captured)) {
      return false;
    }
    relaunch(ui, ticket, &windows, hold);
    true
  }))? {
    snapshot.hand_over();
  }
  Ok(())
}

fn capture_relaunch(app: &AppHandle, hand_over: bool) -> io::Result<Option<Vec<Placed>>> {
  capture_at(app, hand_over, crate::desks::draft_generation(app))
}

fn capture_at(app: &AppHandle, hand_over: bool, generation: u64) -> io::Result<Option<Vec<Placed>>> {
  let Some(drafts) = workspaces::probe(app, true, hand_over) else {
    return Ok(None);
  };
  #[cfg(debug_assertions)]
  if hand_over { pause_check_placement(); }
  crate::desks::placed(app, generation, drafts)
}

fn retry_snapshot_ready(app: &AppHandle, updates: &Updates) -> bool {
  !updates.snapshot_deferred.load(Ordering::SeqCst) || capture_relaunch(app, false).is_ok_and(|windows| {
    windows.is_some_and(|windows| placed::probe_write(&crate::home(), &windows).is_ok())
  })
}

#[cfg(debug_assertions)]
fn pause_check_placement() {
  // The app check lets a pending restore finish in the gap before placement capture.
  if crate::seismic_env("APP_CHECK").is_some() {
    let home = crate::home();
    let paused = home.join("check-placement-paused");
    if fs::rename(home.join("check-pause-placement"), &paused).is_ok() {
      let deadline = std::time::Instant::now() + Duration::from_secs(10);
      while paused.exists() && std::time::Instant::now() < deadline {
        thread::sleep(Duration::from_millis(25));
      }
    }
  }
}

#[cfg(debug_assertions)]
fn pause_check_updating(home: &Path) {
  // The app check lets the updating screen finish loading before relaunch exits.
  if crate::seismic_env("APP_CHECK").is_some() {
    let held = home.join("check-hold-updating");
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while held.exists() && std::time::Instant::now() < deadline {
      thread::sleep(Duration::from_millis(25));
    }
  }
}

fn stage_placements(home: &Path, mut windows: Vec<Placed>, installer: bool, local_page: Option<&str>) -> io::Result<(placed::Staged, Vec<Placed>)> {
  // After an installer returns the local window shows the updater. Keep its previous route,
  // alongside the geometry, open windows and drafts captured after the dialog closes.
  if let (Some(next), Some(local)) = (local_page, windows.iter_mut().find(|p| p.desk == crate::desks::LOCAL)) {
    local.next = next.to_string();
  }
  let snapshot = placed::stage(home, &windows, installer)?;
  Ok((snapshot, windows))
}

fn wait_for_placements(app: &AppHandle, seismic: &Seismic, installer: bool, local_page: Option<&str>) -> io::Result<Option<(placed::Staged, Vec<Placed>)>> {
  while !seismic.stopping.load(Ordering::SeqCst) {
    if let Some(windows) = capture_relaunch(app, true)? {
      return stage_placements(&crate::home(), windows, installer, local_page).map(Some);
    }
    thread::sleep(Duration::from_secs(1));
  }
  Ok(None)
}

pub enum Installed {
  Restarting,
  ResumeServer,
}

fn snapshot_notice(app: &AppHandle, error: &io::Error, outcome: &str) {
  eprintln!("seismic: cannot save the windows for restart: {error}");
  app
    .dialog()
    .message(format!("Seismic could not save its workspace for the update: {error}\n\n{outcome}"))
    .title("Seismic")
    .kind(MessageDialogKind::Error)
    .show(|_| {});
}

fn defer_snapshot(app: &AppHandle, updates: &Updates, error: &io::Error, outcome: &str) {
  // A checkout rebuild retries automatically. A release remains available to install manually.
  let first = !updates.snapshot_deferred.swap(true, Ordering::SeqCst);
  if first || updates.ready.lock().unwrap().is_some() {
    snapshot_notice(app, error, outcome);
  }
}

fn resume_server(app: &AppHandle, updates: &Updates, error: &io::Error) -> Installed {
  defer_snapshot(app, updates, error, "Seismic will restart the local server and keep your workspace open.");
  Installed::ResumeServer
}

pub fn server_ready(updates: &Updates) {
  updates.installing.store(false, Ordering::SeqCst);
}

/// The server ended to be updated: installs the update and starts the app again, the new version
/// if it went in, else this one, after saying why. A new build of the shell is in place already.
pub fn install(app: &AppHandle, seismic: &Seismic, updates: &Updates) -> Installed {
  updates.installing.store(true, Ordering::SeqCst);
  // The local server has already exited. Keep the shell running until its remote pages can
  // hand over, without cutting off activity that began while the local server was stopping.
  let ready = updates.ready.lock().unwrap().clone();
  let release = ready.as_ref().filter(|r| r.bytes.is_some());
  let installer = cfg!(windows) && release.is_some();
  let home = crate::home();
  let (snapshot, windows) = match wait_for_placements(app, seismic, installer, None) {
    Ok(Some(prepared)) => prepared,
    Ok(None) => return Installed::Restarting,
    Err(error) => return resume_server(app, updates, &error),
  };
  if seismic.stopping.load(Ordering::SeqCst) {
    return Installed::Restarting;
  }
  if let Some(w) = local_view(app) {
    let _ = w.navigate(crate::window::bundled_url("/index.html?updating"));
    #[cfg(debug_assertions)]
    pause_check_updating(&crate::home());
  }
  let (snapshot, windows) = if let Some(release) = release {
    if seismic.stopping.load(Ordering::SeqCst) {
      return Installed::Restarting;
    }
    // The Windows installer exits this process on success and launches the replacement itself.
    let installer_snapshot = if installer {
      match snapshot.publish_for_installer(&home) {
        Ok(snapshot) => Some(snapshot),
        Err(error) => return resume_server(app, updates, &error),
      }
    } else {
      drop(snapshot);
      None
    };
    let Ready { update, bytes } = release.as_ref();
    let result = update.install(bytes.as_deref().unwrap());
    // If the installer returned, it did not take over. Disarm its snapshot before any
    // dialog or recapture can wait indefinitely.
    let cleanup = installer_snapshot.map_or(Ok(()), placed::PublishedSnapshot::discard);
    if let Err(e) = result {
      app
        .dialog()
        .message(format!("Seismic {} could not be installed: {e}\n\nSeismic starts again in the version it had.", update.version))
        .title("Seismic")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    } else {
      updates.installed(release);
    }
    let local_page = windows.iter().find(|p| p.desk == crate::desks::LOCAL).map(|p| p.next.as_str());
    match cleanup.and_then(|()| wait_for_placements(app, seismic, false, local_page)) {
      Ok(Some(prepared)) => prepared,
      Ok(None) => return Installed::Restarting,
      Err(error) => {
        seismic.remember_page(local_page.map(str::to_string));
        return resume_server(app, updates, &error);
      }
    }
  } else {
    (snapshot, windows)
  };
  if seismic.stopping.load(Ordering::SeqCst) {
    return Installed::Restarting;
  }
  if let Err(error) = snapshot.publish(&home) {
    seismic.remember_page(windows.iter().find(|p| p.desk == crate::desks::LOCAL).map(|p| p.next.clone()));
    return resume_server(app, updates, &error);
  }
  crate::relaunch(app, seismic, &windows, None);
  Installed::Restarting
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::desks::LOCAL;
  use std::cell::Cell;

  #[test]
  fn installer_fallback_keeps_current_windows_and_drafts_with_the_previous_local_route() {
    let home = std::env::temp_dir().join(format!("seismic-installer-error-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&home).unwrap();
    let local = Placed {
      desk: LOCAL.into(),
      next: "/p/local".into(),
      ..Default::default()
    };
    let remote = |id: &str, draft: &str| Placed {
      desk: id.to_string(),
      origin: Some(format!("https://{id}")),
      next: "/p/remote".into(),
      drafts: vec![("seismic-drafts-note".into(), draft.into())],
      ..Default::default()
    };
    let before = [local.clone(), remote("closed", "closed draft"), remote("edited", "old draft")];
    placed::keep(&home, &before, true).unwrap();

    let current_local = Placed { next: "/".into(), x: 100., focused: true, ..local.clone() };
    let current = vec![current_local, remote("edited", "new draft"), remote("opened", "another draft")];
    let (snapshot, _) = stage_placements(&home, current.clone(), false, Some(&local.next)).unwrap();
    snapshot.publish(&home).unwrap();
    let mut expected = current;
    expected[0].next = local.next;
    assert_eq!(placed::take(&home), expected);
    assert!(placed::take(&home).is_empty());
    fs::remove_dir_all(home).unwrap();
  }

  type Presentation = (bool, bool, bool);
  const FOREGROUND: Presentation = (false, true, true);
  const BACKGROUND: Presentation = (false, true, false);
  const HIDDEN: Presentation = (false, false, false);
  const MINIMIZED: Presentation = (true, false, false);
  const CAPTURED: RebuildRevision = RebuildRevision { draft_generation: 3, selection_turn: 4 };

  #[derive(Clone, Copy)]
  enum FinalPage {
    Unchanged,
    TimestampRefreshed,
    Busy,
    Edited,
    Deleted,
  }

  fn check_rebuild(
    before: Presentation,
    after_publish: Presentation,
    after_request: Option<RebuildRevision>,
    idle: bool,
    page: FinalPage,
    expect_restart: bool,
  ) {
    struct Ui {
      presentation: Cell<Presentation>,
      revision: Cell<Option<RebuildRevision>>,
      restored: std::cell::RefCell<Vec<Placed>>,
      ticket: Cell<Option<Uuid>>,
    }

    let home = std::env::temp_dir().join(format!("seismic-rebuild-{}", Uuid::new_v4()));
    fs::create_dir_all(&home).unwrap();
    let (minimized, visible, focused) = before;
    let windows = vec![Placed {
      desk: LOCAL.into(), next: "/p/local".into(), minimized, visible, focused,
      drafts: vec![
        ("seismic-drafts-note".into(), "unsent".into()),
        ("seismic-kept-local".into(), r#"{"at":1,"drafts":[["composer","unsent"]]}"#.into()),
      ],
      ..Default::default()
    }];
    let ui = Ui {
      presentation: Cell::new(before), revision: Cell::new(Some(CAPTURED)),
      restored: std::cell::RefCell::default(), ticket: Cell::new(None),
    };
    let named_ticket = Cell::new(None);
    let final_page = Cell::new(FinalPage::Unchanged);
    rebuild_after_handover(
      || Ok(Some((windows.clone(), CAPTURED))),
      |captured| {
        // The OS can change focus before the publication call returns.
        let snapshot = placed::publish_rebuild(&home, captured)?;
        named_ticket.set(Some(snapshot.ticket()));
        ui.presentation.set(after_publish);
        Ok(snapshot)
      },
      || {
        assert!(named_ticket.get().is_some(), "publication precedes the final server request");
        // The native window can stay focused while a switch starts or completes.
        ui.revision.set(after_request);
        final_page.set(page);
        idle
      },
      |_| {
        let mut latest = windows.clone();
        match final_page.get() {
          FinalPage::Busy => return Ok(None),
          FinalPage::Edited => latest[0].drafts[0].1 = "latest edit".into(),
          FinalPage::Deleted => latest[0].drafts.clear(),
          FinalPage::TimestampRefreshed => {
            latest[0].drafts[1].1 = r#"{"at":2,"drafts":[["composer","unsent"]]}"#.into();
          }
          FinalPage::Unchanged => {}
        }
        Ok(Some((latest, ())))
      },
      |commit| Ok(commit(&ui)),
      |ui| {
        let (minimized, visible, focused) = ui.presentation.get();
        Some((ui.revision.get()?, RebuildWindow::eligible(minimized, visible, focused)?))
      },
      |ui, ticket, placements, ()| {
        ui.ticket.set(Some(ticket));
        ui.restored.replace(placements.to_vec());
      },
    ).unwrap();
    assert_eq!(ui.ticket.get(), if expect_restart { named_ticket.get() } else { None });
    let expected = if expect_restart { windows } else { vec![] };
    assert_eq!(ui.restored.into_inner(), expected);
    assert_eq!(home.join("app-windows.json.rebuild").exists(), expect_restart);
    assert_eq!(placed::take_for_launch(&home, ui.ticket.get()), expected);
    fs::remove_dir_all(home).unwrap();
  }

  #[test]
  fn rebuild_checks_presentation_after_publication_and_only_then_relaunches() {
    check_rebuild(FOREGROUND, BACKGROUND, Some(CAPTURED), true, FinalPage::Unchanged, false);
    check_rebuild(FOREGROUND, HIDDEN, Some(CAPTURED), true, FinalPage::Unchanged, false);
    check_rebuild(FOREGROUND, MINIMIZED, Some(CAPTURED), true, FinalPage::Unchanged, false);
    check_rebuild(HIDDEN, FOREGROUND, Some(CAPTURED), true, FinalPage::Unchanged, false);
    check_rebuild(FOREGROUND, FOREGROUND, Some(CAPTURED), true, FinalPage::TimestampRefreshed, true);
    check_rebuild(HIDDEN, HIDDEN, Some(CAPTURED), true, FinalPage::Unchanged, true);
  }

  #[test]
  fn rebuild_rechecks_the_workspace_and_server_before_relaunching() {
    let switched = RebuildRevision { draft_generation: 4, selection_turn: 5 };
    let superseded = RebuildRevision { selection_turn: 5, ..CAPTURED };
    let drafts_changed = RebuildRevision { draft_generation: 4, ..CAPTURED };
    check_rebuild(FOREGROUND, FOREGROUND, Some(switched), true, FinalPage::Unchanged, false);
    check_rebuild(FOREGROUND, FOREGROUND, Some(superseded), true, FinalPage::Unchanged, false);
    check_rebuild(FOREGROUND, FOREGROUND, Some(drafts_changed), true, FinalPage::Unchanged, false);
    check_rebuild(FOREGROUND, FOREGROUND, None, true, FinalPage::Unchanged, false);
    check_rebuild(FOREGROUND, FOREGROUND, Some(CAPTURED), false, FinalPage::Unchanged, false);
  }

  #[test]
  fn rebuild_preserves_draft_edits_and_remote_activity_started_during_the_local_request() {
    for page in [FinalPage::Edited, FinalPage::Deleted, FinalPage::Busy] {
      check_rebuild(FOREGROUND, FOREGROUND, Some(CAPTURED), true, page, false);
    }
  }
}
