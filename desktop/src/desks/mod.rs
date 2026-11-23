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
use tauri::{ipc::CapabilityBuilder, AppHandle, Manager, Url, WebviewUrl, WebviewWindow};

pub use list::{Desk, Desks, LOCAL};
use remote::Health;

use crate::{
  window::{self, placed::Placed, Own},
  Seismic,
};

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

/// The label of this machine's window.
pub const MAIN: &str = "main";

/// A remote workspace's window.
#[derive(Clone)]
struct Open {
  desk: String,
  origin: String,
  /// Why the window shows the status page instead of the workspace (remote.rs, `Health::code`).
  problem: Option<&'static str>,
}

#[derive(Default)]
struct Windows {
  /// Each origin's window label, for the run: an origin keeps its label, and its capability, when its
  /// window closes and opens again, and no label ever names a second origin.
  labels: HashMap<String, String>,
  /// The remote workspaces' windows, by label.
  open: HashMap<String, Open>,
  /// Workspaces whose window is on its way (a health check runs).
  opening: HashSet<String>,
  /// The ports of this machine's Seismic its window has a capability for.
  ports: HashSet<u16>,
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

  /// The workspace window `label` shows, and its origin for a remote one.
  pub fn desk_of(&self, label: &str) -> Option<(String, Option<String>)> {
    if label == MAIN {
      return Some((LOCAL.into(), None));
    }
    self.windows.lock().unwrap().open.get(label).map(|o| (o.desk.clone(), Some(o.origin.clone())))
  }

  /// The label of workspace `id`'s window, where it is open.
  fn label_of(&self, id: &str) -> Option<String> {
    if id == LOCAL {
      return Some(MAIN.into());
    }
    self.windows.lock().unwrap().open.iter().find(|(_, o)| o.desk == id).map(|(l, _)| l.clone())
  }

  /// The list as the pages see it, for the page in window `label`.
  pub fn view(&self, label: &str) -> serde_json::Value {
    let desks = self.desks.lock().unwrap().clone();
    let windows = self.windows.lock().unwrap();
    let open: HashSet<String> = windows.open.values().map(|o| o.desk.clone()).collect();
    let (current, problem) = match windows.open.get(label) {
      Some(o) => (Some(o.desk.clone()), o.problem),
      None if label == MAIN => (Some(LOCAL.to_string()), None),
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

fn shell(app: &AppHandle) -> Arc<Shell> {
  app.state::<Arc<Shell>>().inner().clone()
}

/// A capability for window `label` and pages at `origin` alone (none of the bundled pages, which
/// Tauri would grant it too by default), with `permissions`.
fn capability(label: &str, origin: &str, permissions: &[&[&str]]) -> CapabilityBuilder {
  let mut cap = CapabilityBuilder::new(format!("{label}-{}", origin.replace(|c: char| !c.is_ascii_alphanumeric(), "-")))
    .window(label)
    .remote(origin.to_string())
    .local(false);
  for p in permissions.iter().flat_map(|p| p.iter()) {
    cap = cap.permission(*p);
  }
  cap
}

/// Lets this machine's page at `port` call the shell, once per port: its server picks the port as it
/// starts (main.rs, `serve`), before the window goes there.
pub fn allow_local(app: &AppHandle, port: u16) {
  let shell = shell(app);
  if !shell.windows.lock().unwrap().ports.insert(port) {
    return;
  }
  if let Err(e) = app.add_capability(capability(MAIN, &format!("http://127.0.0.1:{port}"), &[PAGE, LOCAL_PAGE])) {
    eprintln!("seismic: no capability for this machine's page: {e}");
  }
}

/// The window label for `origin`, with its capability: the same all run long.
fn label_for(app: &AppHandle, shell: &Shell, origin: &str) -> Result<String, String> {
  let mut windows = shell.windows.lock().unwrap();
  if let Some(label) = windows.labels.get(origin) {
    return Ok(label.clone());
  }
  let label = format!("desk-{}", windows.labels.len() + 1);
  app.add_capability(capability(&label, origin, &[PAGE])).map_err(|e| {
    eprintln!("seismic: no capability for {origin}: {e}");
    "capability".to_string()
  })?;
  windows.labels.insert(origin.to_string(), label.clone());
  Ok(label)
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
  let desk = shell.desks.lock().unwrap().get(id).cloned().ok_or("unknown")?;
  let Some(origin) = desk.origin.clone() else { return Err("unknown".into()) };
  if !shell.windows.lock().unwrap().opening.insert(desk.id.clone()) {
    return Ok(());
  }
  let app = app.clone();
  thread::spawn(move || {
    let health = remote::health(&origin);
    let next = placed.as_ref().map_or("/", |p| p.next.as_str());
    let url = match health {
      Health::Seismic => Url::parse(&format!("{origin}{next}")).ok(),
      _ => None,
    };
    let opened = build(&app, &desk, url, health.code(), placed.as_ref());
    shell.windows.lock().unwrap().opening.remove(&desk.id);
    if let Err(e) = opened {
      eprintln!("seismic: the window of {origin} cannot open: {e}");
    }
    changed(&app);
  });
  Ok(())
}

/// Opens workspace `desk`'s window at `url` (at its origin), or at the status page when there is none,
/// for `problem`.
fn build(app: &AppHandle, desk: &Desk, url: Option<Url>, problem: &'static str, placed: Option<&Placed>) -> Result<WebviewWindow, String> {
  let shell = shell(app);
  let origin = desk.origin.clone().ok_or("local")?;
  let label = label_for(app, &shell, &origin)?;
  let page = match &url {
    Some(url) => WebviewUrl::External(url.clone()),
    None => WebviewUrl::App("status.html".into()),
  };
  shell.windows.lock().unwrap().open.insert(
    label.clone(),
    Open {
      desk: desk.id.clone(),
      origin: origin.clone(),
      problem: url.is_none().then_some(problem),
    },
  );
  let w = window::build(app, &label, page, Own::Remote(origin), placed, false).map_err(|e| {
    shell.windows.lock().unwrap().open.remove(&label);
    e.to_string()
  })?;
  if placed.is_none_or(|p| p.visible) {
    show(&w);
  }
  Ok(w)
}

/// Opens workspace `id`'s window at the one-time link its pairing answered; a window it has at that
/// origin goes there, one at another origin (the workspace moved) closes first.
fn open_paired(app: &AppHandle, id: &str, link: Url) -> Result<(), String> {
  let shell = shell(app);
  let desk = shell.desks.lock().unwrap().get(id).cloned().ok_or("unknown")?;
  if let Some(label) = shell.label_of(id) {
    let at_origin = shell.desk_of(&label).and_then(|(_, o)| o) == desk.origin;
    if let Some(w) = app.get_webview_window(&label) {
      if at_origin {
        if let Some(o) = shell.windows.lock().unwrap().open.get_mut(&label) {
          o.problem = None;
        }
        w.navigate(link).map_err(|e| e.to_string())?;
        show(&w);
        return Ok(());
      }
      let _ = w.destroy();
    }
    shell.windows.lock().unwrap().open.remove(&label);
  }
  build(app, &desk, Some(link), "ok", None).map(|_| ())
}

/// Closes workspace `id`'s window, where it is open.
fn close(app: &AppHandle, id: &str) {
  let shell = shell(app);
  if let Some(label) = shell.label_of(id).filter(|l| l != MAIN) {
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

/// The list or the windows changed: the pages hear of it (`seismic-desks`, they ask for the list
/// again), the macOS menu shows it.
pub fn changed(app: &AppHandle) {
  for w in app.webview_windows().values() {
    let _ = w.eval("window.dispatchEvent(new Event('seismic-desks'))");
  }
  crate::menu::refresh(app);
}

/// The windows as they are now, for the shell that starts next (main.rs, `relaunch`).
pub fn placed(app: &AppHandle, seismic: &Arc<Seismic>) -> Vec<Placed> {
  let shell = shell(app);
  let open = shell.windows.lock().unwrap().open.clone();
  let main = app.get_webview_window(MAIN).and_then(|w| Placed::of(&w, LOCAL, &Own::Local(seismic.clone())));
  let remote = open
    .into_iter()
    .filter(|(_, o)| o.problem.is_none())
    .filter_map(|(label, o)| Placed::of(&app.get_webview_window(&label)?, &o.desk, &Own::Remote(o.origin)));
  main.into_iter().chain(remote).collect()
}

/// Reopens the remote workspaces' windows the shell before left (main.rs), while each is still on
/// the list at the origin it had; the one the owner was in comes last, to the front.
pub fn reopen(app: &AppHandle, mut placed: Vec<Placed>) {
  let shell = shell(app);
  placed.sort_by_key(|p| p.focused);
  for p in placed.into_iter().filter(|p| p.desk != LOCAL) {
    let still = shell.desks.lock().unwrap().get(&p.desk).is_some_and(|d| d.origin == p.origin);
    if still {
      let id = p.desk.clone();
      let _ = open(app, &id, Some(p));
    }
  }
}
