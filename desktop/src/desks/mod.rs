// The workspaces (desks in code) in the app: one window per workspace, each on its one origin for its
// life (window/), with a capability granted as it is made that names that window and that origin
// and never grows: a removed workspace's window closes with it. Switching focuses another window,
// opening it if it is closed, after the shell asked the workspace whether it answers
// (remote.rs, `health`); a workspace that does not shows the bundled status page in its window
// (desktop/ui/status.html). Pairing goes over HTTP from the shell (remote.rs, `pair`): only once it
// went through does a window open, at the one-time link the remote answered. The commands are in
// commands.rs.

pub mod commands;
mod list;
mod remote;

use std::{
  collections::{HashMap, HashSet},
  path::PathBuf,
  sync::{Arc, Mutex, OnceLock},
  thread,
};

use serde_json::json;
use tauri::{ipc::CapabilityBuilder, AppHandle, Manager, Url, WebviewWindow};

pub use list::{Desks, LOCAL};
use remote::Health;

use crate::window::{self, placed::Placed, Own};

/// What every workspace's page may ask of the shell: move the window from its bar, show the system's
/// notifications, list the workspaces and focus or open one.
const PAGE: &[&str] = &[
  "core:window:allow-start-dragging",
  "core:window:allow-internal-toggle-maximize",
  "notification:allow-is-permission-granted",
  "notification:allow-request-permission",
  "notification:allow-notify",
  "allow-desks",
  "allow-open-desk",
];

/// What this machine's page may besides: change the list.
const LOCAL_PAGE: &[&str] = &["allow-add-desk", "allow-rename-desk", "allow-pair-desk", "allow-remove-desk"];

/// The startup window has no server origin or native capability.
pub const STARTUP: &str = "main";

/// A remote workspace's window.
#[derive(Clone)]
struct Open {
  desk: String,
  origin: String,
  /// Why the window shows the status page instead of the workspace (remote.rs, `Health::code`).
  problem: Option<&'static str>,
  drafts: Vec<(String, String)>,
}

#[derive(Default)]
struct Windows {
  next_label: u64,
  /// The remote workspaces' windows, by label.
  open: HashMap<String, Open>,
  /// The revision of each workspace changes when it is paired again, moved or removed.
  revisions: HashMap<String, u64>,
  /// Workspaces with a health check or a native build underway, by revision.
  opening: HashMap<String, u64>,
  /// Snapshots carrying drafts while their restored windows wait for a health check.
  restoring_drafts: HashMap<String, Placed>,
  /// The active local window and its fixed port, once the server answers.
  local: Option<(String, u16)>,
}

impl Windows {
  fn revision(&self, id: &str) -> u64 {
    self.revisions.get(id).copied().unwrap_or_default()
  }

  fn invalidate(&mut self, id: &str) -> u64 {
    self.opening.remove(id);
    self.restoring_drafts.remove(id);
    let revision = self.revisions.entry(id.into()).or_default();
    *revision += 1;
    *revision
  }

  fn finish(&mut self, id: &str, revision: u64) {
    if self.opening.get(id) == Some(&revision) {
      self.opening.remove(id);
      self.restoring_drafts.remove(id);
    }
  }
}

pub struct Shell {
  pub desks: Mutex<Desks>,
  windows: Mutex<Windows>,
  home: PathBuf,
  machine: OnceLock<String>,
}

impl Shell {
  pub fn new(home: PathBuf) -> Shell {
    Shell {
      desks: Mutex::new(Desks::load(&home)),
      windows: Default::default(),
      home,
      machine: OnceLock::new(),
    }
  }

  /// This machine's name, which its workspace goes by until the owner names it.
  pub fn machine(&self) -> &str {
    self.machine.get_or_init(machine_name)
  }

  fn save(&self, desks: &Desks) -> Result<(), String> {
    desks.save(&self.home).map_err(|e| {
      eprintln!("seismic: the workspaces cannot be saved: {e}");
      "unsaved".to_string()
    })
  }

  pub fn local(&self) -> (String, Option<u16>) {
    match &self.windows.lock().unwrap().local {
      Some((label, port)) => (label.clone(), Some(*port)),
      None => (STARTUP.into(), None),
    }
  }

  /// The workspace window `label` shows, and its origin for a remote one.
  pub fn desk_of(&self, label: &str) -> Option<(String, Option<String>)> {
    if label == self.local().0 {
      return Some((LOCAL.into(), None));
    }
    self.windows.lock().unwrap().open.get(label).map(|o| (o.desk.clone(), Some(o.origin.clone())))
  }

  /// The label of workspace `id`'s window, where it is open.
  fn label_of(&self, id: &str) -> Option<String> {
    if id == LOCAL {
      return Some(self.local().0);
    }
    self.windows.lock().unwrap().open.iter().find(|(_, o)| o.desk == id).map(|(l, _)| l.clone())
  }

  /// The list as the pages see it, for the page in window `label`.
  pub fn view(&self, label: &str) -> serde_json::Value {
    let desks = self.desks.lock().unwrap().clone();
    let windows = self.windows.lock().unwrap();
    let local = windows.local.as_ref().map_or(STARTUP, |(label, _)| label.as_str());
    let open: HashSet<String> = windows.open.values().map(|o| o.desk.clone()).collect();
    let (current, problem) = match windows.open.get(label) {
      Some(o) => (Some(o.desk.clone()), o.problem),
      None if label == local => (Some(LOCAL.to_string()), None),
      None => (None, None),
    };
    drop(windows);
    let list: Vec<_> = desks
      .list
      .iter()
      .map(|d| json!({ "id": d.id, "name": d.shown_name(self.machine()), "origin": d.origin, "local": d.local(), "open": d.local() || open.contains(&d.id) }))
      .collect();
    json!({ "current": current, "problem": problem, "list": list })
  }
}

/// This machine's name as its owner knows it: "Nick's MacBook Pro", else its host name.
fn machine_name() -> String {
  let run = |program: &str, args: &[&str]| {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    crate::no_window(&mut cmd);
    cmd
      .output()
      .ok()
      .filter(|o| o.status.success())
      .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
      .filter(|n| !n.is_empty())
  };
  let named = if cfg!(target_os = "macos") {
    run("scutil", &["--get", "ComputerName"])
  } else {
    None
  };
  named
    .or_else(|| std::env::var("COMPUTERNAME").ok())
    .or_else(|| run("hostname", &[]).map(|h| h.split('.').next().unwrap_or_default().to_string()))
    .unwrap_or_else(|| "This machine".into())
}

pub fn shell(app: &AppHandle) -> Arc<Shell> {
  app.state::<Arc<Shell>>().inner().clone()
}

/// URLPattern treats colons in an IPv6 host as pattern syntax. The port separator stays literal.
fn remote_pattern(origin: &str) -> Result<String, String> {
  let url = Url::parse(origin).map_err(|e| e.to_string())?;
  let host = url.host_str().ok_or("address")?.replace(':', r"\:");
  let port = url.port().map_or(String::new(), |p| format!(":{p}"));
  let pattern = format!("{}://{host}{port}", url.scheme());
  // Tauri registers a URLPattern, which must be valid before it touches the runtime ACL.
  pattern.parse::<tauri::utils::acl::RemoteUrlPattern>().map_err(|e| e.to_string())?;
  Ok(pattern)
}

/// Grants `permissions` to the window at its own origin alone.
fn capability(label: &str, origin: &str, permissions: &[&[&str]]) -> Result<CapabilityBuilder, String> {
  let mut cap = CapabilityBuilder::new(format!("{label}-{}", origin.replace(|c: char| !c.is_ascii_alphanumeric(), "-")))
    .window(label)
    .remote(remote_pattern(origin)?)
    .local(false);
  for p in permissions.iter().flat_map(|p| p.iter()) {
    cap = cap.permission(*p);
  }
  Ok(cap)
}

/// Allocates a fresh label for every native window. A capability never grants a second origin
/// to the same label, and a late Destroyed event cannot remove a replacement's tracking.
fn label_for(shell: &Shell, prefix: &str) -> String {
  let mut windows = shell.windows.lock().unwrap();
  windows.next_label += 1;
  format!("{prefix}-{}", windows.next_label)
}

/// Connects this machine's window to the server. Runs on the UI thread, where closing the old
/// webview removes it immediately, even though destroying its native window queues an event.
pub fn connect_local(app: &AppHandle, port: u16, page: Url, handed_over: bool) -> Result<(), String> {
  let shell = shell(app);
  let (label, previous) = shell.local();
  let old = app.get_webview_window(&label).ok_or("window")?;
  let own = Own::Local(Some(port));
  if !own.at(&page) {
    return Err("elsewhere".into());
  }
  if previous == Some(port) {
    return old.navigate(page).map_err(|e| e.to_string());
  }
  let placed = Placed::of(&old, LOCAL, &Own::Local(previous));
  let label = label_for(&shell, "main");
  let origin = own.origin().expect("local server port");
  app.add_capability(capability(&label, &origin, &[PAGE, LOCAL_PAGE])?).map_err(|e| e.to_string())?;
  let w = window::build(app, &label, own, placed.as_ref(), previous.is_none() && handed_over).map_err(|e| e.to_string())?;
  if let Err(error) = old.as_ref().close() {
    let _ = w.destroy();
    return Err(error.to_string());
  }
  shell.windows.lock().unwrap().local = Some((label, port));
  let _ = old.destroy();
  w.navigate(page).map_err(|e| e.to_string())?;
  window::show_placed(&w, placed.as_ref(), placed.as_ref().is_some_and(|p| p.focused)).map_err(|e| e.to_string())?;
  Ok(())
}

/// HTTP runs off the UI thread. Its results and workspace/window mutations are applied on it.
pub async fn on_ui<T: Send + 'static>(app: AppHandle, action: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static) -> Result<T, String> {
  let (send, mut receive) = tauri::async_runtime::channel(1);
  let handle = app.clone();
  app
    .run_on_main_thread(move || {
      let _ = send.try_send(action(&handle));
    })
    .map_err(|e| e.to_string())?;
  receive.recv().await.ok_or_else(|| "window".to_string())?
}

pub fn show(w: &WebviewWindow) {
  let _ = w.show();
  let _ = w.unminimize();
  let _ = w.set_focus();
}

/// Brings workspace `id` to the front: its window, or a new one once the shell asked whether it
/// answers (on a thread of its own: that takes up to seconds), at the page `placed` names.
pub fn open(app: &AppHandle, id: &str, placed: Option<Placed>) -> Result<(), String> {
  let shell = shell(app);
  if let Some(w) = shell.label_of(id).and_then(|l| app.get_webview_window(&l)) {
    show(&w);
    return Ok(());
  }
  let origin = shell.desks.lock().unwrap().get(id).and_then(|d| d.origin.clone()).ok_or("unknown")?;
  if placed.as_ref().is_some_and(|p| p.origin.as_deref() != Some(origin.as_str())) {
    return Ok(());
  }
  let revision = {
    let mut windows = shell.windows.lock().unwrap();
    if windows.opening.contains_key(id) {
      return Ok(());
    }
    let revision = windows.revision(id);
    windows.opening.insert(id.into(), revision);
    if let Some(placed) = placed.as_ref().filter(|p| !p.drafts.is_empty()) {
      windows.restoring_drafts.insert(id.into(), placed.clone());
    }
    revision
  };
  let id = id.to_string();
  let app = app.clone();
  thread::spawn(move || {
    let health = remote::health(&origin);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
      if !can_build(&shell, &id, &origin, revision) {
        return;
      }
      let next = placed.as_ref().map_or("/", |p| p.next.as_str());
      let url = match health {
        Health::Seismic => Url::parse(&format!("{origin}{next}")).ok(),
        _ => None,
      };
      let opened = build(&handle, &id, &origin, revision, url, health.code(), placed.as_ref());
      shell.windows.lock().unwrap().finish(&id, revision);
      if let Err(e) = opened {
        eprintln!("seismic: the window of {origin} cannot open: {e}");
      }
      changed(&handle);
    });
  });
  Ok(())
}

fn can_build(shell: &Shell, id: &str, origin: &str, revision: u64) -> bool {
  shell.desks.lock().unwrap().get(id).and_then(|d| d.origin.as_deref()) == Some(origin) && shell.windows.lock().unwrap().opening.get(id) == Some(&revision)
}

/// Builds for the reservation at `revision`, publishing the window just before its page can run.
fn build(app: &AppHandle, id: &str, origin: &str, revision: u64, url: Option<Url>, problem: &'static str, placed: Option<&Placed>) -> Result<(), String> {
  let shell = shell(app);
  let own = Own::Remote(origin.into());
  if url.as_ref().is_some_and(|u| !own.at(u)) {
    return Err("elsewhere".into());
  }
  let label = label_for(&shell, "desk");
  app.add_capability(capability(&label, origin, &[PAGE])?).map_err(|e| {
    eprintln!("seismic: no capability for {origin}: {e}");
    "capability".to_string()
  })?;
  let w = window::build(app, &label, own, placed, placed.is_some()).map_err(|e| e.to_string())?;
  // The native constructor can pump events on Windows. Check again before loading any content.
  if !can_build(&shell, id, origin, revision) {
    let _ = w.destroy();
    return Err("unknown".into());
  }
  let showing_status = url.is_none();
  shell.windows.lock().unwrap().open.insert(
    label.clone(),
    Open {
      desk: id.into(),
      origin: origin.into(),
      problem: showing_status.then_some(problem),
      drafts: placed.map_or_else(Vec::new, |p| p.drafts.clone()),
    },
  );
  let page = url.unwrap_or_else(|| window::bundled_url("/status.html"));
  if let Err(error) = w.navigate(page) {
    shell.windows.lock().unwrap().open.remove(&label);
    let _ = w.destroy();
    return Err(error.to_string());
  }
  let focus = placed.is_some_and(|p| p.focused)
    && !app.webview_windows().values().any(|other| other.label() != label && other.is_focused().unwrap_or(false));
  window::show_placed(&w, placed, focus).map_err(|e| e.to_string())
}

/// Applies a pairing on the UI thread, taking over any pending health check.
fn open_paired(app: &AppHandle, id: &str, origin: &str, link: Url) -> Result<(), String> {
  let shell = shell(app);
  if !Own::Remote(origin.into()).at(&link) {
    return Err("elsewhere".into());
  }
  let (revision, restoring) = {
    let mut windows = shell.windows.lock().unwrap();
    let mut restoring = windows.restoring_drafts.remove(id).filter(|p| p.origin.as_deref() == Some(origin));
    let revision = windows.invalidate(id);
    if let Some(p) = &mut restoring {
      p.visible = true;
      windows.restoring_drafts.insert(id.into(), p.clone());
    }
    (revision, restoring)
  };
  if let Some(label) = shell.label_of(id) {
    let at_origin = shell.desk_of(&label).and_then(|(_, o)| o).as_deref() == Some(origin);
    if let Some(w) = app.get_webview_window(&label).filter(|_| at_origin) {
      w.navigate(link).map_err(|e| e.to_string())?;
      if let Some(o) = shell.windows.lock().unwrap().open.get_mut(&label) {
        o.problem = None;
      }
      show(&w);
      return Ok(());
    }
    close(app, id);
  }
  shell.windows.lock().unwrap().opening.insert(id.into(), revision);
  let opened = build(app, id, origin, revision, Some(link), "ok", restoring.as_ref());
  shell.windows.lock().unwrap().finish(id, revision);
  if opened.is_ok() && restoring.is_some() {
    if let Some(w) = shell.label_of(id).and_then(|l| app.get_webview_window(&l)) {
      show(&w);
    }
  }
  opened
}

/// Closes workspace `id`'s window, where it is open.
fn close(app: &AppHandle, id: &str) {
  let shell = shell(app);
  if let Some(label) = shell.label_of(id).filter(|_| id != LOCAL) {
    shell.windows.lock().unwrap().open.remove(&label);
    if let Some(w) = app.get_webview_window(&label) {
      let _ = w.destroy();
    }
  }
}

/// A window has gone (main.rs): its workspace is closed now.
pub fn closed(app: &AppHandle, label: &str) {
  let shell = shell(app);
  if shell.windows.lock().unwrap().open.remove(label).is_some() {
    changed(app);
  }
}

/// The page at the workspace's origin now owns its restored drafts in session storage.
pub fn drafts_restored(app: &AppHandle, label: &str) {
  if let Some(window) = shell(app).windows.lock().unwrap().open.get_mut(label) {
    window.drafts.clear();
  }
}

/// The list or the windows changed: the pages hear of it (`seismic-desks`, they ask for the list
/// again), the macOS menu shows it.
pub fn changed(app: &AppHandle) {
  for w in app.webview_windows().values() {
    let _ = w.eval("window.dispatchEvent(new Event('seismic-desks'))");
  }
  crate::menu::refresh(app);
}

/// The windows as they are now, for the shell that starts next (main.rs, `relaunch`).
pub fn placed(app: &AppHandle, mut drafts: HashMap<String, Vec<(String, String)>>) -> Option<Vec<Placed>> {
  let shell = shell(app);
  let (open, pending) = {
    let windows = shell.windows.lock().unwrap();
    let pending: Vec<_> = windows.restoring_drafts.values()
      .filter(|p| !windows.open.values().any(|o| o.desk == p.desk))
      .cloned().collect();
    (windows.open.clone(), pending)
  };
  let (label, port) = shell.local();
  let main = app.get_webview_window(&label).and_then(|w| Placed::of(&w, LOCAL, &Own::Local(port)));
  let mut snapshots: Vec<_> = main.into_iter().chain(pending).collect();
  for (label, o) in open {
    let Some(w) = app.get_webview_window(&label) else { continue };
    let unsent = drafts.remove(&label).unwrap_or(o.drafts);
    if let Some(mut placed) = Placed::of(&w, &o.desk, &Own::Remote(o.origin)) {
      placed.drafts = unsent;
      snapshots.push(placed);
    } else if !unsent.is_empty() {
      return None;
    }
  }
  drafts.is_empty().then_some(snapshots)
}

/// Reopens the remote workspaces' windows the shell before left (main.rs), while each is still on
/// the list at the origin it had. Only the previously focused window can ask for focus.
pub fn reopen(app: &AppHandle, placed: Vec<Placed>) {
  for p in placed.into_iter().filter(|p| p.desk != LOCAL) {
    let id = p.desk.clone();
    let _ = open(app, &id, Some(p));
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn an_ipv6_capability_matches_only_its_origin() {
    let origin = "https://[fd7a::2]:4417";
    let pattern: tauri::utils::acl::RemoteUrlPattern = remote_pattern(origin).unwrap().parse().unwrap();
    assert!(pattern.test(&Url::parse(&format!("{origin}/p/x")).unwrap()));
    for other in ["https://[fd7a::3]:4417/", "https://[fd7a::2]:4418/", "http://[fd7a::2]:4417/"] {
      assert!(!pattern.test(&Url::parse(other).unwrap()));
    }
  }

  #[test]
  fn stale_health_check_cannot_build_or_clear_its_replacement() {
    let shell = Shell {
      desks: Mutex::new(Desks::default()),
      windows: Default::default(),
      home: PathBuf::new(),
      machine: OnceLock::new(),
    };
    let studio = "https://studio";
    let lab = "https://lab";
    let id = shell.desks.lock().unwrap().add("", studio).unwrap().id;
    shell.windows.lock().unwrap().opening.insert(id.clone(), 0);
    assert!(can_build(&shell, &id, studio, 0));

    // A pairing at the same address supersedes the health check too.
    {
      let mut windows = shell.windows.lock().unwrap();
      let revision = windows.invalidate(&id);
      windows.opening.insert(id.clone(), revision);
      windows.finish(&id, 0);
    }
    assert!(!can_build(&shell, &id, studio, 0));
    assert!(can_build(&shell, &id, studio, 1));

    shell.desks.lock().unwrap().move_to(&id, lab).unwrap();
    assert!(!can_build(&shell, &id, studio, 1));
    shell.windows.lock().unwrap().invalidate(&id);

    // Moving back does not revive the earlier check.
    shell.desks.lock().unwrap().move_to(&id, studio).unwrap();
    assert!(!can_build(&shell, &id, studio, 1));
    shell.desks.lock().unwrap().remove(&id).unwrap();
    assert!(!can_build(&shell, &id, studio, 1));
  }
}
