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
use tauri::{utils::config::BundleType, AppHandle};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::window::placed::{self, Placed};
use crate::{main_window, no_window, post, Seismic};

/// The exit code with which the server asks the shell to install the update (src/server/self-update.ts).
pub const EXIT: i32 = 77;
const EVERY: Duration = Duration::from_secs(6 * 3600);
/// After a check that failed (offline, say).
const AGAIN: Duration = Duration::from_secs(30 * 60);
/// The switch for checking for releases (docs/release.md), with `UPDATES_ENABLED` in src/server/app-update.ts.
const CHECK_RELEASES: bool = true;
/// Where a .deb update is fetched by hand, as the server expects it (`RELEASES` in src/server/app-update.ts).
const RELEASES: &str = "https://github.com/nickpalenchar/seismic/releases";

/// A newer version, downloaded and checked; or for a .deb, where to get it.
struct Ready {
  update: Update,
  bytes: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct Updates {
  ready: Mutex<Option<Ready>>,
  /// Installed from a checkout: a new build of the shell is in this one's place.
  rebuilt: Mutex<bool>,
  installing: AtomicBool,
}

fn deb() -> bool {
  matches!(tauri::utils::platform::bundle_type(), Some(BundleType::Deb))
}

pub fn start(app: &AppHandle, seismic: Arc<Seismic>) -> Arc<Updates> {
  let updates = Arc::new(Updates::default());
  if let Some(checkout) = crate::checkout() {
    let Some(built) = option_env!("SEISMIC_BUILT_TREE").or(option_env!("OBEYA_BUILT_TREE")).filter(|t| !t.is_empty()) else {
      return updates;
    };
    let (home, u) = (crate::home(), updates.clone());
    thread::spawn(move || rebuild(&checkout, built, &home, &u));
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
  *updates.ready.lock().unwrap() = Some(Ready { update, bytes });
  Ok(())
}

/// Tells the server of the version that is ready, while it is one the app started in this run. A
/// new build of the shell where the server runs on without it (started from a terminal) starts
/// again by itself (`start_again`).
fn report(app: &AppHandle, seismic: &Seismic, updates: &Updates) {
  let port = seismic.port.load(Ordering::SeqCst);
  if port == 0 || seismic.stopping.load(Ordering::SeqCst) || updates.installing.load(Ordering::SeqCst) {
    return;
  }
  if !seismic.child.load(Ordering::SeqCst) {
    if *updates.rebuilt.lock().unwrap() {
      if let Err(error) = start_again(app, seismic, port) {
        *updates.rebuilt.lock().unwrap() = false;
        snapshot_notice(app, &error, "The update was deferred.");
      }
    }
    return;
  }
  let body = match updates.ready.lock().unwrap().as_ref() {
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
  if body["rebuilt"] != true || workspaces::ready(app, false).is_some() {
    post(port, "/api/app-update", &body);
  }
}

/// A new build of the shell is in place, and the server runs on without it: it starts again once the
/// owner neither dictates nor watches a video (as the server's restart waits for them, which says
/// so) and its window allows (`may_relaunch`), after the page handed over what a reload keeps
/// (src/ui/api.ts, `handOver`), or did not within a few seconds (a page that does not know how).
fn start_again(app: &AppHandle, seismic: &Seismic, port: u16) -> io::Result<()> {
  let ask = |kept: &str| post(port, "/api/app-rebuilt", &json!({ "kept": kept }));
  let now = |a: &Option<serde_json::Value>| a.as_ref().is_some_and(|a| a["now"] == true);
  if !now(&ask("")) || !crate::may_relaunch(app) || workspaces::ready(app, false).is_none() {
    return Ok(());
  }
  let token = format!("{}", crate::now_ms());
  if let Some(w) = main_window(app) {
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
  if now(&ask("")) && crate::may_relaunch(app) {
    if let Some(placed) = prepare_relaunch(app, false, None)? {
      crate::relaunch(app, seismic, &placed);
    }
  }
  Ok(())
}

/// Publish the snapshot before anything that can exit, including the installer itself.
fn prepare_relaunch(app: &AppHandle, installer: bool, local_page: Option<&str>) -> io::Result<Option<Vec<Placed>>> {
  let generation = crate::desks::draft_generation(app);
  let Some(drafts) = workspaces::ready(app, true) else {
    return Ok(None);
  };
  #[cfg(debug_assertions)]
  pause_check_placement();
  let Some(windows) = crate::desks::placed(app, generation, drafts)? else {
    return Ok(None); // a remote workspace is still in use or changing windows
  };
  keep_placements(&crate::home(), windows, installer, local_page).map(Some)
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

fn keep_placements(home: &Path, mut windows: Vec<Placed>, installer: bool, local_page: Option<&str>) -> io::Result<Vec<Placed>> {
  // After an installer returns the local window shows the updater. Keep its previous route,
  // alongside the geometry, open windows and drafts captured after the dialog closes.
  if let (Some(next), Some(local)) = (local_page, windows.iter_mut().find(|p| p.desk == crate::desks::LOCAL)) {
    local.next = next.to_string();
  }
  placed::keep(home, &windows, installer)?;
  Ok(windows)
}

fn wait_for_placements(app: &AppHandle, seismic: &Seismic, installer: bool, local_page: Option<&str>) -> io::Result<Option<Vec<Placed>>> {
  while !seismic.stopping.load(Ordering::SeqCst) {
    if let Some(windows) = prepare_relaunch(app, installer, local_page)? {
      return Ok(Some(windows));
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
    .message(format!("Seismic could not save its open windows for the update: {error}\n\n{outcome}"))
    .title("Seismic")
    .kind(MessageDialogKind::Error)
    .show(|_| {});
}

fn resume_server(app: &AppHandle, updates: &Updates, error: &io::Error) -> Installed {
  *updates.rebuilt.lock().unwrap() = false;
  snapshot_notice(app, error, "Seismic will restart the local server and keep your windows open.");
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
  let ready = updates.ready.lock().unwrap().take();
  let installer = cfg!(windows) && ready.as_ref().is_some_and(|r| r.bytes.is_some());
  let mut windows = match wait_for_placements(app, seismic, installer, None) {
    Ok(Some(windows)) => windows,
    Ok(None) => return Installed::Restarting,
    Err(error) => return resume_server(app, updates, &error),
  };
  if seismic.stopping.load(Ordering::SeqCst) {
    placed::discard(&crate::home());
    return Installed::Restarting;
  }
  if let Some(w) = main_window(app) {
    let _ = w.navigate(crate::window::bundled_url("/index.html?updating"));
  }
  if let Some(Ready { update, bytes: Some(bytes) }) = ready {
    // on Windows the installer takes over here: it replaces the app and starts it again
    if let Err(e) = update.install(bytes) {
      app
        .dialog()
        .message(format!("Seismic {} could not be installed: {e}\n\nSeismic starts again in the version it had.", update.version))
        .title("Seismic")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    }
    let local_page = windows.iter().find(|p| p.desk == crate::desks::LOCAL).map(|p| p.next.as_str());
    windows = match wait_for_placements(app, seismic, false, local_page) {
      Ok(Some(current)) => current,
      Ok(None) => {
        placed::discard(&crate::home());
        return Installed::Restarting;
      }
      Err(error) => {
        placed::discard(&crate::home());
        seismic.remember_page(local_page.map(str::to_string));
        return resume_server(app, updates, &error);
      }
    };
  }
  if seismic.stopping.load(Ordering::SeqCst) {
    placed::discard(&crate::home());
    return Installed::Restarting;
  }
  crate::relaunch(app, seismic, &windows);
  Installed::Restarting
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::desks::LOCAL;

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
    keep_placements(&home, current.clone(), false, Some(&local.next)).unwrap();
    let mut expected = current;
    expected[0].next = local.next;
    assert_eq!(placed::take(&home), expected);
    assert!(placed::take(&home).is_empty());
    fs::remove_dir_all(home).unwrap();
  }
}
