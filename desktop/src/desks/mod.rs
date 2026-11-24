// The shell selects one workspace for its native window. Switching replaces only the webview,
// whose capability and native guards belong to one origin for its lifetime.

pub mod commands;
mod list;
mod remote;

use std::{
  collections::HashMap,
  io,
  path::PathBuf,
  sync::{Arc, Mutex, OnceLock},
  thread,
  time::Duration,
};

use serde_json::json;
use tauri::{ipc::CapabilityBuilder, AppHandle, Manager, Url, Webview, Window};
use uuid::Uuid;

pub use list::{Desks, LOCAL};
use remote::Health;

use crate::window::{self, placed::Placed, Own};

/// What every workspace's page may ask of the shell: move the window from its bar, show the system's
/// notifications, list the workspaces and switch workspaces.
const PAGE: &[&str] = &[
  "allow-workspace-start-dragging",
  "allow-workspace-toggle-maximize",
  "notification:allow-is-permission-granted",
  "notification:allow-request-permission",
  "notification:allow-notify",
  "allow-desks",
  "allow-open-desk",
];

/// What this machine's page may besides: change the list.
const LOCAL_PAGE: &[&str] = &["allow-add-desk", "allow-rename-desk", "allow-pair-desk", "allow-remove-desk"];
#[cfg(not(target_os = "linux"))]
const DRAFTS: &[&str] = &["allow-workspace-draft-checkpoint", "allow-workspace-restore-drafts"];
#[cfg(target_os = "linux")]
const DRAFTS: &[&str] = &["allow-workspace-restore-drafts"];

/// The startup window has no server origin or native capability.
pub const WINDOW: &str = "main";
pub const STARTUP: &str = "startup";

/// The workspace currently in the window.
#[derive(Clone)]
struct WorkspaceView {
  label: String,
  desk: String,
  own: Own,
  /// The last page at this origin, also used while showing the bundled status page.
  next: String,
  /// Why the window shows the status page instead of the workspace (remote.rs, `Health::code`).
  problem: Option<&'static str>,
  /// The backup until a document at this window's origin confirms receipt.
  drafts: Vec<(String, String)>,
  draft_checkpoint: Option<Uuid>, // only for a placement saved by an older shell
  awaiting_drafts: bool,
  departure: Departure,
}

#[derive(Clone, Default)]
struct Departure {
  observed: bool,
  activation: f64,
  drafts: Option<Vec<(String, String)>>,
  previous_in_flight: Option<f64>,
  /// A previous document's completed checkpoint, held until its successor confirms delivery.
  returning: Vec<(String, String)>,
  returning_from: Option<f64>,
  offered: bool,
}

pub type DraftOffer = (Option<f64>, Vec<(String, String)>);

fn include_missing(entries: &mut Vec<(String, String)>, backup: Vec<(String, String)>) {
  for (key, value) in backup {
    if !entries.iter().any(|(k, _)| *k == key) {
      entries.push((key, value));
    }
  }
}

impl Departure {
  fn carry(&mut self, activation: f64, entries: Vec<(String, String)>) {
    let before = self.returning.len();
    include_missing(&mut self.returning, entries);
    if self.returning.len() != before {
      self.returning_from = if before == 0 { Some(activation) } else { self.returning_from.filter(|a| *a == activation) };
    }
  }

  fn receive(&mut self, activation: f64, drafts: Option<Vec<(String, String)>>) -> bool {
    if activation < self.activation {
      if self.previous_in_flight == Some(activation) {
        if let Some(entries) = drafts {
          self.previous_in_flight = None;
          self.carry(activation, entries);
          return true;
        }
      }
      return false;
    }
    if activation == self.activation && drafts.is_none() {
      return false;
    }
    if activation > self.activation {
      self.offered = false;
      self.previous_in_flight = (self.activation > 0.0 && self.drafts.is_none()).then_some(self.activation);
      if let Some(previous) = self.drafts.take() {
        self.carry(self.activation, previous);
      }
    }
    self.observed = true;
    self.activation = activation;
    self.drafts = drafts;
    true
  }

  fn restore(&mut self, activation: f64) -> Result<Option<DraftOffer>, &'static str> {
    if activation > self.activation || (activation == self.activation && self.previous_in_flight.is_some()) {
      return Err("pending"); // A lifecycle message is still in the native queue.
    }
    if activation != self.activation {
      return Err("stale");
    }
    self.offered = !self.returning.is_empty();
    Ok(self.offered.then(|| (self.returning_from, self.returning.clone())))
  }

  fn confirm(&mut self, activation: f64) -> bool {
    if activation != self.activation || !self.offered {
      return false;
    }
    self.returning.clear();
    self.returning_from = None;
    self.offered = false;
    true
  }
}

#[derive(Default)]
struct Views {
  next_label: u64,
  active: Option<WorkspaceView>,
  local_port: Option<u16>,
  /// Each selection supersedes the last one, including while a health check is running.
  turn: u64,
  pending: Option<Selection>,
  /// The revision changes when a workspace is paired again, moved or removed.
  revisions: HashMap<String, u64>,
  /// Routes and drafts for workspaces whose webviews have been closed.
  parked: HashMap<String, Placed>,
  restore: Option<String>,
  draft_generation: u64,
}

struct Selection {
  desk: String,
  waiters: Vec<OpenWaiter>,
}

type OpenWaiter = tauri::async_runtime::Sender<Result<(), String>>;

impl Views {
  fn label(&self) -> &str {
    self.active.as_ref().map_or(STARTUP, |view| view.label.as_str())
  }

  fn revision(&self, id: &str) -> u64 {
    self.revisions.get(id).copied().unwrap_or_default()
  }

  fn invalidate(&mut self, id: &str) {
    if self.pending.as_ref().is_some_and(|p| p.desk == id) {
      self.cancel();
    }
    self.parked.remove(id);
    *self.revisions.entry(id.into()).or_default() += 1;
  }

  fn cancel(&mut self) {
    self.turn += 1;
    self.finish(Err("superseded".into()));
  }

  fn finish(&mut self, result: Result<(), String>) {
    if let Some(pending) = self.pending.take() {
      for waiter in pending.waiters {
        let _ = waiter.try_send(result.clone());
      }
    }
  }

  fn drafts_restored(&mut self, label: &str) -> bool {
    let Some(view) = self.active.as_mut().filter(|w| w.label == label && w.awaiting_drafts) else { return false };
    view.awaiting_drafts = false;
    view.drafts.clear();
    view.draft_checkpoint = None;
    self.draft_generation += 1;
    true
  }
}

pub struct Shell {
  pub desks: Mutex<Desks>,
  views: Mutex<Views>,
  home: PathBuf,
  machine: OnceLock<String>,
}

impl Shell {
  pub fn new(home: PathBuf, saved: Vec<Placed>) -> Shell {
    let desks = Desks::load(&home);
    let valid = |p: &&Placed| desks.get(&p.desk).is_some_and(|d| d.origin == p.origin);
    let restore = window::placed::primary(&saved).filter(valid).filter(|p| p.desk != LOCAL).map(|p| p.desk.clone());
    let parked = saved.iter().filter(valid).map(|p| (p.desk.clone(), p.clone())).collect();
    Shell {
      desks: Mutex::new(desks),
      views: Mutex::new(Views { parked, restore, ..Default::default() }),
      home,
      machine: OnceLock::new(),
    }
  }

  pub fn machine(&self) -> &str {
    self.machine.get_or_init(machine_name)
  }

  fn save(&self, desks: &Desks) -> Result<(), String> {
    desks.save(&self.home).map_err(|e| {
      eprintln!("seismic: the workspaces cannot be saved: {e}");
      "unsaved".to_string()
    })
  }

  pub fn local_port(&self) -> Option<u16> {
    self.views.lock().unwrap().local_port
  }

  pub fn is_current(&self, label: &str) -> bool {
    self.views.lock().unwrap().label() == label
  }

  pub fn current(&self) -> String {
    self.views.lock().unwrap().active.as_ref().map_or_else(|| LOCAL.into(), |view| view.desk.clone())
  }

  pub fn desk_of(&self, label: &str) -> Option<(String, Own)> {
    self.views.lock().unwrap().active.as_ref().filter(|view| view.label == label).map(|view| (view.desk.clone(), view.own.clone()))
  }

  /// The current workspace, including when its origin is unavailable.
  pub fn view(&self, label: &str) -> serde_json::Value {
    let (current, problem) = {
      let views = self.views.lock().unwrap();
      match &views.active {
        Some(v) if v.label == label => (Some(v.desk.clone()), v.problem),
        _ => (None, None),
      }
    };
    let list: Vec<_> = self.desks.lock().unwrap().list.iter().map(|d| {
      json!({ "id": d.id, "name": d.shown_name(self.machine()), "origin": d.origin, "local": d.local(), "open": current.as_ref() == Some(&d.id) })
    }).collect();
    json!({ "current": current, "problem": problem, "list": list })
  }
}

pub fn active_view(app: &AppHandle) -> Option<Webview> {
  let label = shell(app).views.lock().unwrap().label().to_string();
  app.get_webview(&label)
}

pub fn local_view(app: &AppHandle) -> Option<Webview> {
  let state = shell(app);
  let label = {
    let views = state.views.lock().unwrap();
    if views.active.as_ref().is_some_and(|v| v.desk != LOCAL) {
      return None;
    }
    views.label().to_string()
  };
  app.get_webview(&label)
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
    .webview(label)
    .remote(remote_pattern(origin)?)
    .local(false);
  for p in permissions.iter().flat_map(|p| p.iter()) {
    cap = cap.permission(*p);
  }
  Ok(cap)
}

/// HTTP and draft sampling run off the UI thread. Native view changes run on it.
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

pub fn show(w: &Window) {
  let _ = w.show();
  let _ = w.unminimize();
  let _ = w.set_focus();
}

struct Capture {
  label: String,
  generation: u64,
  workspace: Option<Placed>,
}

impl Capture {
  fn matches(&self, views: &Views) -> bool {
    views.label() == self.label && views.draft_generation == self.generation
  }
}

/// Read the outgoing page before destroying its webview. A status page uses the last
/// origin-scoped departure instead. A failed read leaves the current page in place.
fn capture(app: &AppHandle) -> Result<Capture, String> {
  let state = shell(app);
  let (active, label, generation) = {
    let views = state.views.lock().unwrap();
    (views.active.clone(), views.label().to_string(), views.draft_generation)
  };
  let workspace = if let Some(active) = active {
    let view = app.get_webview(&label).ok_or("window")?;
    let url = view.url().map_err(|_| "window")?;
    let sample = if active.own.at(&url) {
      let origin = active.own.origin().ok_or("elsewhere")?;
      Some(window::drafts::sample(&view, &origin, Duration::from_secs(2)).ok_or("drafts")?)
    } else {
      None
    };
    Some(saved_view(&active, sample)?)
  } else {
    None
  };
  Ok(Capture { label, generation, workspace })
}

/// The outgoing view's drafts and route take precedence over any older parked copy.
fn saved_view(view: &WorkspaceView, sample: Option<(String, Vec<(String, String)>)>) -> Result<Placed, String> {
  let (next, sampled) = match sample {
    Some((next, entries)) => (next, entries),
    None if view.departure.observed => (view.next.clone(), view.departure.drafts.clone().ok_or("drafts")?),
    None => (view.next.clone(), vec![]),
  };
  let mut drafts = view.departure.returning.clone();
  include_missing(&mut drafts, sampled);
  include_missing(&mut drafts, view.drafts.clone());
  Ok(Placed {
    desk: view.desk.clone(),
    origin: match &view.own { Own::Remote(origin) => Some(origin.clone()), _ => None },
    next,
    drafts,
    draft_checkpoint: view.draft_checkpoint,
    ..Default::default()
  })
}

struct Destination {
  desk: String,
  own: Own,
  url: Url,
  problem: Option<&'static str>,
  handed_over: bool,
}

/// Prepare the new view before closing the old one. Every view has its own capability
/// label and immutable origin, even if the selected workspace was visited earlier.
fn mount(app: &AppHandle, target: Destination, turn: u64, outgoing: Capture) -> Result<(), String> {
  let state = shell(app);
  let (label, restore) = {
    let mut views = state.views.lock().unwrap();
    if views.turn != turn || !outgoing.matches(&views) {
      return Err("superseded".into());
    }
    let restore = outgoing.workspace.as_ref().filter(|p| p.desk == target.desk)
      .or_else(|| views.parked.get(&target.desk))
      .filter(|p| match &target.own { Own::Remote(o) => p.origin.as_ref() == Some(o), Own::Local(_) => p.origin.is_none() })
      .cloned();
    views.next_label += 1;
    let prefix = if target.desk == LOCAL { "local" } else { "desk" };
    (format!("{prefix}-{}", views.next_label), restore)
  };
  let origin = target.own.origin().ok_or("elsewhere")?;
  let permissions = if target.desk == LOCAL { LOCAL_PAGE } else { &[] };
  app.add_capability(capability(&label, &origin, &[PAGE, DRAFTS, permissions])?).map_err(|e| e.to_string())?;
  let w = window::build(app, &label, target.own.clone(), restore.as_ref(), target.handed_over).map_err(|e| e.to_string())?;
  let mounted = (|| {
    let mut views = state.views.lock().unwrap();
    // Creating a webview can pump the Windows event loop.
    if views.turn != turn || !outgoing.matches(&views) {
      return Err("superseded".into());
    }
    let new = WorkspaceView {
      label,
      desk: target.desk.clone(),
      own: target.own,
      next: restore.as_ref().map_or_else(|| "/".into(), |p| p.next.clone()),
      problem: target.problem,
      drafts: restore.as_ref().map_or_else(Vec::new, |p| p.drafts.clone()),
      draft_checkpoint: restore.as_ref().and_then(|p| p.draft_checkpoint),
      awaiting_drafts: restore.as_ref().is_some_and(|p| p.draft_checkpoint.is_some() || !p.drafts.is_empty()),
      departure: Departure::default(),
    };
    let old = views.active.replace(new);
    views.draft_generation += 1;
    drop(views);

    let navigate = || -> tauri::Result<()> {
      #[cfg(debug_assertions)]
      if target.desk != LOCAL && crate::seismic_env("APP_CHECK").is_some() && std::fs::remove_file(state.home.join("check-window-open-error")).is_ok() {
        return Err(io::Error::other("test workspace open error").into());
      }
      w.navigate(target.url)
    };
    if let Err(error) = navigate() {
      state.views.lock().unwrap().active = old;
      return Err(error.to_string());
    }
    {
      let mut views = state.views.lock().unwrap();
      views.parked.remove(&target.desk);
      views.restore = None;
      if let Some(workspace) = outgoing.workspace.filter(|p| p.desk != target.desk) {
        views.parked.insert(workspace.desk.clone(), workspace);
      }
    }
    if let Some(old) = app.get_webview(&outgoing.label) {
      if let Err(e) = window::close(&old) {
        eprintln!("seismic: the previous workspace could not be closed: {e}");
        let _ = old.hide();
      }
    }
    if w.window().is_focused().unwrap_or(false) {
      let _ = w.set_focus();
    }
    changed(app);
    Ok(())
  })();
  if mounted.is_err() {
    let _ = window::close(&w);
  }
  mounted
}

/// Switch to this machine after the local server answers, or remember its port while
/// the owner is using a remote workspace. Runs on the server watcher thread.
pub fn connect_local(app: &AppHandle, port: u16, page: Url, handed_over: bool) -> Result<(), String> {
  let state = shell(app);
  let previous = state.views.lock().unwrap().local_port.replace(port);
  let own = Own::Local(Some(port));
  if !own.at(&page) {
    return Err("elsewhere".into());
  }

  // The selected remote can follow the startup screen directly. Loading the local
  // page first would race its document initialization against the draft capture.
  if previous.is_none() {
    let (send, mut receive) = tauri::async_runtime::channel(1);
    let restoring = tauri::async_runtime::block_on(on_ui(app.clone(), move |app| {
      let state = shell(app);
      let restore = state.views.lock().unwrap().restore.clone();
      restore.map_or(Ok(false), |id| open(app, &id, true, Some(send)).map(|_| true))
    }))?;
    if restoring && tauri::async_runtime::block_on(receive.recv()).is_some_and(|result| result.is_ok()) {
      return Ok(());
    }
  }

  let (turn, same_origin) = loop {
    let (send, mut receive) = tauri::async_runtime::channel(1);
    {
      let mut views = state.views.lock().unwrap();
      if views.active.as_ref().is_some_and(|v| v.desk != LOCAL) {
        return Ok(());
      }
      if let Some(pending) = &mut views.pending {
        pending.waiters.push(send);
      } else {
        views.restore = None;
        break (views.turn, views.active.as_ref().is_some_and(|v| v.own == own));
      }
    }
    // If a switch fails while the local port changed, attach the current local
    // page once the switch settles. A successful switch leaves the remote in place.
    let _ = tauri::async_runtime::block_on(receive.recv());
  };
  let outgoing = if same_origin { None } else { Some(capture(app)?) };
  tauri::async_runtime::block_on(on_ui(app.clone(), move |app| {
    if state.views.lock().unwrap().turn != turn {
      return Ok(());
    }
    if let Some(outgoing) = outgoing {
      let destination = Destination { desk: LOCAL.into(), own, url: page, problem: None, handed_over: previous.is_none() && handed_over };
      mount(app, destination, turn, outgoing)
    } else {
      local_view(app).ok_or("window")?.navigate(page).map_err(|e| e.to_string())
    }
  }))
}

/// Select one workspace. The last selection wins, even when earlier health checks
/// are still running. Repeated selections of the same destination share its result.
pub fn open(app: &AppHandle, id: &str, handed_over: bool, waiter: Option<OpenWaiter>) -> Result<(), String> {
  let state = shell(app);
  let origin = state.desks.lock().unwrap().get(id).ok_or("unknown")?.origin.clone();
  let (turn, revision) = {
    let mut views = state.views.lock().unwrap();
    if !handed_over {
      views.restore = None;
    }
    if let Some(pending) = views.pending.as_mut().filter(|p| p.desk == id) {
      pending.waiters.extend(waiter);
      return Ok(());
    }
    views.cancel();
    if views.active.as_ref().is_some_and(|v| v.desk == id) {
      if let Some(waiter) = waiter {
        let _ = waiter.try_send(Ok(()));
      }
      drop(views);
      crate::menu::refresh(app);
      return Ok(());
    }
    views.pending = Some(Selection { desk: id.into(), waiters: waiter.into_iter().collect() });
    (views.turn, views.revision(id))
  };
  crate::menu::refresh(app);

  let id = id.to_string();
  let app = app.clone();
  thread::spawn(move || {
    let health = origin.as_deref().map(remote::health);
    if state.views.lock().unwrap().turn != turn {
      return;
    }
    let outgoing = capture(&app);
    let pending = state.clone();
    let queued = tauri::async_runtime::block_on(on_ui(app, move |app| {
      let opened = (|| {
        if !state.desks.lock().unwrap().get(&id).is_some_and(|d| d.origin == origin) {
          return Err("unknown".to_string());
        }
        let (port, next) = {
          let views = state.views.lock().unwrap();
          if views.turn != turn || views.revision(&id) != revision {
            return Err("superseded".to_string());
          }
          (views.local_port, views.parked.get(&id).map_or_else(|| "/".into(), |p| p.next.clone()))
        };
        let (own, url, problem) = match origin {
          Some(origin) => {
            let problem = health.filter(|h| *h != Health::Seismic).map(|h| h.code());
            let url = if problem.is_some() { window::bundled_url("/status.html") } else {
              Url::parse(&format!("{origin}{next}")).map_err(|_| "address")?
            };
            (Own::Remote(origin), url, problem)
          }
          None => {
            let port = port.ok_or("unreachable")?;
            let url = Url::parse(&crate::login_link(port, &next, false)).map_err(|_| "address")?;
            (Own::Local(Some(port)), url, None)
          }
        };
        let target = Destination { desk: id, own, url, problem, handed_over };
        mount(app, target, turn, outgoing?)
      })();
      if let Err(error) = &opened {
        if error != "superseded" {
          eprintln!("seismic: the workspace could not be selected: {error}");
        }
      }
      let mut views = state.views.lock().unwrap();
      if views.turn == turn {
        views.finish(opened.map_err(|e| match e.as_str() {
          "drafts" | "unreachable" | "superseded" | "unknown" => e,
          _ => "window".into(),
        }));
      }
      Ok(())
    }));
    if queued.is_err() {
      let mut views = pending.views.lock().unwrap();
      if views.turn == turn {
        views.finish(Err("window".into()));
      }
    }
  });
  Ok(())
}

/// Start the paired workspace at its fresh login link.
fn open_paired(app: &AppHandle, id: &str, origin: &str, link: Url, outgoing: Result<Capture, String>) -> Result<(), String> {
  let state = shell(app);
  let own = Own::Remote(origin.into());
  if !own.at(&link) {
    return Err("elsewhere".into());
  }
  let turn = {
    let mut views = state.views.lock().unwrap();
    views.cancel();
    views.restore = None;
    *views.revisions.entry(id.into()).or_default() += 1;
    if views.parked.get(id).is_some_and(|p| p.origin.as_deref() != Some(origin)) {
      views.parked.remove(id);
    }
    views.turn
  };
  mount(app, Destination { desk: id.into(), own, url: link, problem: None, handed_over: false }, turn, outgoing?)
}


pub fn drafts_restored(app: &AppHandle, label: &str) {
  let restored = shell(app).views.lock().unwrap().drafts_restored(label);
  #[cfg(debug_assertions)]
  if restored && crate::seismic_env("APP_CHECK").is_some() {
    let _ = std::fs::write(crate::home().join(format!("check-drafts-received-{label}")), "");
  }
  #[cfg(not(debug_assertions))]
  let _ = restored;
}

pub fn draft_generation(app: &AppHandle) -> u64 {
  shell(app).views.lock().unwrap().draft_generation
}

pub fn page_loaded(app: &AppHandle, label: &str, url: &Url) {
  let shell = shell(app);
  let mut windows = shell.views.lock().unwrap();
  if let Some(window) = windows.active.as_mut().filter(|v| v.label == label) {
    window.next = crate::next_of(url);
    if !window.departure.observed {
      window.departure.observed = true;
      windows.draft_generation += 1;
    }
  }
}

/// Only the remote capability for this exact window label and origin grants the checkpoint command.
pub fn departure(shell: &Shell, label: &str, activation: f64, url: &str, entries: Option<Vec<(String, String)>>, received: bool) {
  let mut windows = shell.views.lock().unwrap();
  if let Some(window) = windows.active.as_mut().filter(|v| v.label == label) {
    let confirmed = received && window.departure.confirm(activation);
    let recorded = window.departure.receive(activation, entries);
    if recorded && activation == window.departure.activation {
      if let Ok(url) = Url::parse(url) {
        if window.own.at(&url) {
          window.next = crate::next_of(&url);
        }
      }
    }
    if confirmed || recorded {
      windows.draft_generation += 1;
    }
  }
}

/// The capability belongs only to the invoking workspace's label and origin. An old document
/// cannot read or clear what is waiting for a newer activation in the same window.
pub fn restore_departure(shell: &Shell, label: &str, activation: f64) -> Result<Option<DraftOffer>, &'static str> {
  let mut windows = shell.views.lock().unwrap();
  let window = windows.active.as_mut().filter(|v| v.label == label).ok_or("unknown")?;
  window.departure.restore(activation)
}

/// Let the displayed page and the native menu refresh after a selection or list change.
pub fn changed(app: &AppHandle) {
  if let Some(w) = active_view(app) {
    let _ = w.eval("window.dispatchEvent(new Event('seismic-desks'))");
  }
  crate::menu::refresh(app);
}

/// Capture the native window once and keep the drafts and routes of the parked workspaces.
pub fn placed(app: &AppHandle, draft_generation: u64, mut drafts: HashMap<String, Vec<(String, String)>>) -> io::Result<Option<Vec<Placed>>> {
  let state = shell(app);
  let (active, parked, restore) = {
    let views = state.views.lock().unwrap();
    if views.draft_generation != draft_generation {
      return Ok(None);
    }
    (views.active.clone(), views.parked.clone(), views.restore.clone())
  };
  let Some(native) = crate::main_window(app) else { return Ok(None) };
  let mut layout = Placed::layout(&native).ok_or_else(|| io::Error::other("Seismic could not read the window position."))?;
  if let Some(active) = active {
    let Some(w) = app.get_webview(&active.label) else { return Ok(None) };
    let Ok(url) = w.url() else { return Ok(None) };
    let sample = if active.own.at(&url) {
      let Some(entries) = drafts.remove(&active.label) else { return Ok(None) };
      Some((crate::next_of(&url), entries))
    } else {
      None
    };
    let saved = saved_view(&active, sample).map_err(|_| io::Error::other("Seismic could not save the current workspace's drafts. Return to its page and try the update again."))?;
    layout.desk = saved.desk;
    layout.origin = saved.origin;
    layout.next = saved.next;
    layout.drafts = saved.drafts;
    layout.draft_checkpoint = saved.draft_checkpoint;
  } else if let Some(saved) = restore.as_ref().and_then(|id| parked.get(id)) {
    layout.desk = saved.desk.clone();
    layout.origin = saved.origin.clone();
    layout.next = saved.next.clone();
    layout.drafts = saved.drafts.clone();
    layout.draft_checkpoint = saved.draft_checkpoint;
  }
  let current = layout.desk.clone();
  let mut snapshots = vec![layout];
  snapshots.extend(parked.into_values().filter(|p| p.desk != current).map(|p| Placed { primary: false, focused: false, visible: false, ..p }).collect::<Vec<_>>());
  Ok((drafts.is_empty() && state.views.lock().unwrap().draft_generation == draft_generation).then_some(snapshots))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn status_needs_the_latest_documents_departure_even_when_its_drafts_are_empty() {
    let mut departure = Departure::default();
    assert!(departure.receive(1.0, Some(vec![("seismic-drafts-shop".into(), "old".into())])));
    assert!(departure.receive(2.0, None));
    assert!(departure.observed && departure.drafts.is_none());
    assert!(!departure.receive(1.0, Some(vec![])));
    assert!(departure.receive(2.0, Some(vec![])));
    assert!(!departure.receive(2.0, None));
    assert_eq!(departure.drafts, Some(vec![]));
  }

  #[test]
  fn a_reconnect_keeps_the_previous_draft_until_the_right_document_receives_it() {
    let mut departure = Departure::default();
    let latest = vec![("seismic-drafts-shop".into(), "newest".into())];
    assert!(departure.receive(1.0, Some(latest.clone())));
    assert_eq!(departure.restore(2.0), Err("pending"));
    assert!(departure.receive(2.0, None));
    assert_eq!(departure.restore(2.0), Ok(Some((Some(1.0), latest.clone()))));
    // The first returning document leaves before committing the delivered drafts.
    assert!(departure.receive(2.0, Some(vec![])));
    assert!(departure.receive(3.0, None));
    assert!(!departure.confirm(2.0));
    assert!(!departure.confirm(3.0));
    assert_eq!(departure.restore(3.0), Ok(Some((Some(1.0), latest))));
    assert!(departure.confirm(3.0));
    assert!(departure.receive(3.0, Some(vec![])));
    assert!(departure.receive(4.0, None));
    assert_eq!(departure.restore(4.0), Ok(None));
  }

  #[test]
  fn a_returning_page_waits_for_the_departure_message_when_it_arrives_late() {
    let mut departure = Departure::default();
    let latest = vec![("seismic-wish-shop".into(), "unfinished".into())];
    assert!(departure.receive(1.0, None));
    assert!(departure.receive(2.0, None));
    assert_eq!(departure.restore(2.0), Err("pending"));
    assert!(departure.receive(1.0, Some(latest.clone())));
    assert_eq!(departure.restore(2.0), Ok(Some((Some(1.0), latest))));
    assert!(!departure.receive(1.0, Some(vec![])));
    assert!(departure.confirm(2.0));
  }

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
  fn replacing_a_switch_settles_waiters_without_reusing_its_turn() {
    let mut views = Views::default();
    let (send, mut receive) = tauri::async_runtime::channel(1);
    views.pending = Some(Selection { desk: "studio".into(), waiters: vec![send] });
    let studio_turn = views.turn;
    views.cancel();
    assert_ne!(views.turn, studio_turn);
    assert_eq!(receive.try_recv().unwrap(), Err("superseded".into()));
    assert!(views.pending.is_none());
  }
}
