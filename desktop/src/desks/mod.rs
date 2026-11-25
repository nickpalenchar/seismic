// The shell selects one workspace for its native window. Switching replaces only the webview,
// whose capability and native guards belong to one origin for its lifetime.

mod attachments;
pub mod commands;
mod list;
mod remote;

use std::{
  collections::{HashMap, HashSet},
  io,
  path::PathBuf,
  sync::{mpsc, Arc, Mutex, OnceLock},
  thread,
  time::{Duration, Instant},
};

use serde_json::json;
use tauri::{ipc::CapabilityBuilder, AppHandle, Manager, Url, Webview, Window};
use uuid::Uuid;

use attachments::OnBack;
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
  /// The route the main-document load now under way asked for, before redirects (`provisional`)
  /// and once it committed (`requested`), until a workspace document verifies. Recovery fetches and
  /// Try again opens it; restoration keeps `next`, the route last verified.
  provisional: Option<String>,
  requested: Option<String>,
  /// Why the window shows the status page instead of the workspace (remote.rs, `Health::code`).
  problem: Option<&'static str>,
  /// The backup until a document at this window's origin confirms receipt.
  drafts: Vec<(String, String)>,
  draft_checkpoint: Option<Uuid>, // only for a placement saved by an older shell
  awaiting_drafts: bool,
  departure: Departure,
  /// The most recent workspace activation whose route was accepted.
  route_activation: f64,
  /// The current main-document load, verification, or cache refresh (`verify_load`).
  loading: Option<u64>,
  /// The last main-document commit, kept while a replacement load is provisional.
  committed_load: Option<u64>,
  /// Verification of the visible workspace document survives a provisional replacement.
  visible_load: VisibleLoad,
  /// A same-origin sign-in has been queued and can still replace the old local document.
  local_reloading: Option<Instant>,
  /// The check reloaded a rejected page once: a fresh cached copy of a placeholder answers a plain
  /// navigation again, a reload revalidates it.
  revalidated: bool,
}

impl WorkspaceView {
  /// Where recovery leads: the route the failed load asked for, else the last verified one.
  fn retry_route(&self) -> &str {
    self.requested.as_deref().unwrap_or(&self.next)
  }

  fn remember_route(&mut self, activation: f64, next: String) -> bool {
    if activation < self.route_activation {
      return false;
    }
    self.route_activation = activation;
    if next == self.next {
      return false;
    }
    self.next = next;
    true
  }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum VisibleLoad {
  Settled,
  AwaitingFinish,
  Checking,
}

#[derive(Clone, Default)]
struct Departure {
  activation: f64,
  drafts: Option<Vec<(String, String)>>,
  previous_in_flight: Option<f64>,
  /// A previous document's completed checkpoint, held until its successor confirms delivery.
  returning: Vec<(String, String)>,
  returning_from: Option<f64>,
  offered: bool,
  /// The activation whose document stopped waiting for the copy and runs its editors with its own
  /// drafts, newer than a copy it did not take: the previous checkpoint can arrive after its deadline.
  /// Its message can also overtake the activation's own.
  settled: Option<f64>,
  previous_settled: bool,
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
  /// `wins`: the entries come from a document that settled, and replace the held copy's.
  fn carry(&mut self, activation: f64, entries: Vec<(String, String)>, wins: bool) {
    let merged = if wins {
      let mut merged = entries;
      include_missing(&mut merged, self.returning.clone());
      merged
    } else {
      let mut merged = self.returning.clone();
      include_missing(&mut merged, entries);
      merged
    };
    if merged != self.returning {
      self.returning_from = if self.returning.is_empty() { Some(activation) } else { self.returning_from.filter(|a| *a == activation) };
      self.returning = merged;
    }
  }

  /// What a departing or sampled document holds, merged with the held copy by which is newer.
  fn with_returning(&self, entries: Vec<(String, String)>) -> Vec<(String, String)> {
    let (mut first, rest) = if self.is_settled() { (entries, self.returning.clone()) } else { (self.returning.clone(), entries) };
    include_missing(&mut first, rest);
    first
  }

  fn receive(&mut self, activation: f64, drafts: Option<Vec<(String, String)>>) -> bool {
    if activation < self.activation {
      if self.previous_in_flight == Some(activation) {
        if let Some(entries) = drafts {
          self.previous_in_flight = None;
          self.carry(activation, entries, self.previous_settled);
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
      self.previous_settled = self.is_settled();
      if let Some(previous) = self.drafts.take() {
        self.carry(self.activation, previous, self.previous_settled);
      }
    }
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

  /// The document gave up waiting for the copy (`drafts.rs`, `restoreDeparture`).
  fn settle(&mut self, activation: f64) -> bool {
    if activation < self.activation || (activation == self.activation && self.offered) || self.settled == Some(activation) {
      return false;
    }
    self.settled = Some(activation);
    true
  }

  fn is_settled(&self) -> bool {
    self.settled == Some(self.activation)
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
  /// Concurrent switch attempts can be sampling the same outgoing webview.
  hidden_for_capture: HashMap<String, usize>,
  active: Option<WorkspaceView>,
  local_port: Option<u16>,
  attaching_local: bool,
  /// Each selection supersedes the last one, including while a health check is running.
  turn: u64,
  pending: Option<Selection>,
  /// The revision changes when a workspace is paired again, moved or removed.
  revisions: HashMap<String, u64>,
  /// Routes and drafts for workspaces whose webviews have been closed.
  parked: HashMap<String, Placed>,
  restore: Option<String>,
  draft_generation: u64,
  next_load: u64,
}

struct Selection {
  desk: String,
  page: Option<String>,
  in_place: bool,
  waiters: Vec<OpenWaiter>,
}

impl Selection {
  fn matches(&self, desk: &str, page: Option<&str>) -> bool {
    self.desk == desk && self.page.as_deref() == page
  }
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
    self.draft_generation += 1;
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

  fn load(&mut self) -> u64 {
    self.next_load += 1;
    self.next_load
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
  /// The label families with a capability (`grant`).
  granted: Mutex<HashSet<String>>,
  attachment_decision: Mutex<()>,
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
      granted: Mutex::default(),
      attachment_decision: Mutex::default(),
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

  /// A local stop may leave the shell serving the selected remote workspace.
  pub fn disconnect_if_remote(&self) -> bool {
    let mut views = self.views.lock().unwrap();
    if !views.active.as_ref().is_some_and(|view| view.desk != LOCAL) && views.restore.is_none() {
      return false;
    }
    views.local_port = None;
    if views.pending.as_ref().is_some_and(|p| p.desk == LOCAL) {
      views.turn += 1;
      views.finish(Err("unreachable".into()));
    }
    true
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

/// Grants `permissions` to the webviews labelled `{family}-*`, at `origin` alone.
fn capability(family: &str, origin: &str, permissions: &[&[&str]]) -> Result<CapabilityBuilder, String> {
  let mut cap = CapabilityBuilder::new(family)
    .webview(format!("{family}-*"))
    .remote(remote_pattern(origin)?)
    .local(false);
  for p in permissions.iter().flat_map(|p| p.iter()) {
    cap = cap.permission(*p);
  }
  Ok(cap)
}

/// The label family of a workspace's webviews at `origin`. Tauri keeps a capability for the life of
/// the app, so each family gets its one once (`grant`) and every webview of it a fresh label.
fn family(desk: &str, origin: &str) -> String {
  let prefix = if desk == LOCAL { "local" } else { "desk" };
  // Hex keeps every origin byte distinct and excludes the delimiter before the instance number.
  use std::fmt::Write;
  let mut label = format!("{prefix}-");
  for byte in origin.bytes() {
    write!(label, "{byte:02x}").unwrap();
  }
  label
}

fn grant(app: &AppHandle, family: &str, origin: &str, permissions: &[&[&str]]) -> Result<(), String> {
  let state = shell(app);
  let mut granted = state.granted.lock().unwrap();
  if !granted.contains(family) {
    app.add_capability(capability(family, origin, permissions)?).map_err(|e| e.to_string())?;
    granted.insert(family.into());
  }
  Ok(())
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

/// Stop input before sampling so the owner cannot edit or navigate the outgoing page
/// during native construction. Every failed or superseded attempt releases its hold.
pub(crate) struct CaptureHold {
  app: AppHandle,
  label: Option<String>,
}

impl CaptureHold {
  pub(crate) fn acquire(app: &AppHandle, label: String) -> Result<Self, String> {
    tauri::async_runtime::block_on(on_ui(app.clone(), move |app| {
      let state = shell(app);
      if !state.is_current(&label) {
        return Err("superseded".into());
      }
      let view = app.get_webview(&label).ok_or("window")?;
      view.hide().map_err(|e| e.to_string())?;
      *state.views.lock().unwrap().hidden_for_capture.entry(label.clone()).or_default() += 1;
      Ok(Self { app: app.clone(), label: Some(label) })
    }))
  }

  pub(crate) fn keep_until_exit(mut self) {
    self.label.take();
  }
}

impl Drop for CaptureHold {
  fn drop(&mut self) {
    let Some(label) = self.label.take() else { return };
    let app = self.app.clone();
    let _ = self.app.run_on_main_thread(move || {
      let state = shell(&app);
      let mut views = state.views.lock().unwrap();
      let Some(count) = views.hidden_for_capture.get_mut(&label) else { return };
      *count -= 1;
      if *count != 0 {
        return;
      }
      views.hidden_for_capture.remove(&label);
      if views.label() == label {
        drop(views);
        if let Some(view) = app.get_webview(&label) {
          let _ = view.show();
          if view.window().is_focused().unwrap_or(false) {
            let _ = view.set_focus();
          }
        }
      }
    });
  }
}

struct Capture {
  hold: Option<attachments::Hold>,
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
fn capture(app: &AppHandle, turn: u64, on_back: OnBack) -> Result<Capture, String> {
  capture_after(app, turn, on_back, false, |_| Ok(())).map(|(capture, ())| capture)
}

fn capture_after<T>(
  app: &AppHandle, turn: u64, on_back: OnBack, connecting: bool,
  mut prepare: impl FnMut(bool) -> Result<T, String>,
) -> Result<(Capture, T), String> {
  let state = shell(app);
  let (active, label) = {
    let views = state.views.lock().unwrap();
    (views.active.is_some(), views.label().to_string())
  };
  let (hold, prepared) = if active {
    let view = app.get_webview(&label).ok_or("window")?;
    let (hold, prepared) = attachments::hold_after(app, &state, &view, turn, on_back, connecting, prepare)?;
    (Some(hold), prepared)
  } else {
    (None, prepare(false)?)
  };
  let (active, generation) = {
    let views = state.views.lock().unwrap();
    if views.turn != turn || views.label() != label {
      return Err("superseded".into());
    }
    (views.active.clone(), views.draft_generation)
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
  Ok((Capture { hold, label, generation, workspace }, prepared))
}

/// The outgoing view's drafts and route take precedence over any older parked copy.
fn saved_view(view: &WorkspaceView, sample: Option<window::drafts::Sample>) -> Result<Placed, String> {
  let (next, sampled) = match sample {
    Some(sample) if matches!(view.own, Own::Remote(_)) && !sample.workspace => (view.next.clone(), sample.entries),
    Some(sample) => (sample.next, sample.entries),
    // Only a workspace document that reported its activation owes a departure checkpoint.
    None if view.departure.activation > 0.0 => (view.next.clone(), view.departure.drafts.clone().ok_or("drafts")?),
    None => (view.next.clone(), vec![]),
  };
  let mut drafts = view.departure.with_returning(sampled);
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
fn mount(app: &AppHandle, target: Destination, turn: u64, mut outgoing: Capture) -> Result<(), String> {
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
    (views.next_label, restore)
  };
  let origin = target.own.origin().ok_or("elsewhere")?;
  let family = family(&target.desk, &origin);
  let label = format!("{family}-{label}");
  let permissions = if target.desk == LOCAL { LOCAL_PAGE } else { &[] };
  grant(app, &family, &origin, &[PAGE, DRAFTS, permissions])?;
  let w = window::build(app, &label, target.own.clone(), restore.as_ref(), target.handed_over).map_err(|e| e.to_string())?;
  let mounted = (|| {
    let mut views = state.views.lock().unwrap();
    // Creating a webview can pump the Windows event loop.
    if views.turn != turn || !outgoing.matches(&views) {
      return Err("superseded".into());
    }
    let loading = (matches!(target.own, Own::Remote(_)) && target.problem.is_none()).then(|| views.load());
    let watched = loading.map(|token| (label.clone(), token));
    let new = WorkspaceView {
      label,
      desk: target.desk.clone(),
      own: target.own,
      next: restore.as_ref().map_or_else(|| "/".into(), |p| p.next.clone()),
      provisional: None,
      requested: None,
      problem: target.problem,
      drafts: restore.as_ref().map_or_else(Vec::new, |p| p.drafts.clone()),
      draft_checkpoint: restore.as_ref().and_then(|p| p.draft_checkpoint),
      awaiting_drafts: restore.as_ref().is_some_and(|p| p.draft_checkpoint.is_some() || !p.drafts.is_empty()),
      departure: Departure::default(),
      route_activation: 0.0,
      loading,
      committed_load: None,
      visible_load: VisibleLoad::Settled,
      local_reloading: None,
      revalidated: false,
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
    if let Some(hold) = &mut outgoing.hold {
      hold.navigating();
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
    if let Some((label, token)) = watched {
      watch_load(app, &label, token);
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

/// Begin restoration from the startup view independently of local server startup.
pub fn restore_selected(app: &AppHandle) -> Result<(), String> {
  let restore = shell(app).views.lock().unwrap().restore.clone();
  if let Some(id) = restore {
    open(app, &id, true, None, None)?;
  }
  Ok(())
}

pub fn cancel_selection(app: &AppHandle) {
  shell(app).views.lock().unwrap().cancel();
}

/// Switch to this machine after the local server answers, or remember its port while
/// the owner is using a remote workspace. Runs on the server watcher thread.
pub fn connect_local(app: &AppHandle, port: u16, page: Url, handed_over: bool) -> Result<(), String> {
  let state = shell(app);
  let previous = {
    let mut views = state.views.lock().unwrap();
    views.attaching_local = true;
    views.local_port.replace(port)
  };
  let attached = attach_local(app, &state, port, page, handed_over && previous.is_none());
  state.views.lock().unwrap().attaching_local = false;
  attached
}

fn attach_local(app: &AppHandle, state: &Arc<Shell>, port: u16, page: Url, handed_over: bool) -> Result<(), String> {
  let own = Own::Local(Some(port));
  if !own.at(&page) {
    return Err("elsewhere".into());
  }

  // The watcher records each port once. A selection that starts before the page is attached
  // must settle first, after which this attaches the current port or yields to the remote.
  loop {
    let (turn, same_origin) = loop {
      let (send, mut receive) = tauri::async_runtime::channel(1);
      let outgoing = {
        let mut views = state.views.lock().unwrap();
        if crate::is_stopping(app) || views.active.as_ref().is_some_and(|v| v.desk != LOCAL) {
          return Ok(());
        }
        let same_origin = views.active.as_ref().is_some_and(|v| v.own == own);
        // An in-place route needs the reauthenticated document. Let the reload
        // proceed, then deliver the route once that document is ready.
        let outgoing = views.label().to_string();
        if let Some(pending) = views.pending.as_mut().filter(|p| !(p.in_place && same_origin)) {
          pending.waiters.push(send);
          outgoing
        } else {
          views.restore = None;
          break (views.turn, same_origin);
        }
      };
      // If a switch fails while the local port changed, attach the current local
      // page once it settles. A switch that already signed into the new port has
      // its own destination and does not need another login.
      let result = tauri::async_runtime::block_on(receive.recv());
      if matches!(result, Some(Ok(()))) && state.views.lock().unwrap().active.as_ref().is_some_and(|v| v.label != outgoing && v.own == own) {
        return Ok(());
      }
    };
    // Reauthenticating at the same port also unloads the document doing the upload.
    enum Attach {
      Reload(attachments::Hold),
      Replace(Capture),
    }
    let outgoing = if same_origin {
      local_view(app).ok_or_else(|| "window".to_string())
        .and_then(|view| attachments::hold(app, state, &view, turn, OnBack::Wait)).map(Attach::Reload)
    } else {
      capture(app, turn, OnBack::Wait).map(Attach::Replace)
    };
    let (state, own, page) = (state.clone(), own.clone(), page.clone());
    let attached = tauri::async_runtime::block_on(on_ui(app.clone(), move |app| {
      if crate::is_stopping(app) {
        return Ok(());
      }
      if state.views.lock().unwrap().turn != turn {
        return Err("superseded".into());
      }
      match outgoing? {
        Attach::Reload(hold) => {
          #[cfg(debug_assertions)]
          if crate::seismic_env("APP_CHECK").is_some() && std::fs::remove_file(state.home.join("check-local-navigation-not-committed")).is_ok() {
            // Exercise the fallback when the runtime accepts navigation but leaves the old document.
            hold.awaiting_navigation();
            return Ok(());
          }
          let view = local_view(app).ok_or("window")?;
          if let Some(active) = state.views.lock().unwrap().active.as_mut().filter(|v| v.label == view.label()) {
            active.local_reloading = Some(Instant::now());
          }
          if let Err(error) = view.navigate(page) {
            if let Some(active) = state.views.lock().unwrap().active.as_mut().filter(|v| v.label == view.label()) {
              active.local_reloading = None;
            }
            return Err(error.to_string());
          }
          hold.awaiting_navigation();
          Ok(())
        }
        Attach::Replace(captured) => {
          let target = Destination { desk: LOCAL.into(), own, url: page, problem: None, handed_over };
          mount(app, target, turn, captured)
        }
      }
    }));
    if !matches!(&attached, Err(e) if e == "superseded") {
      return attached;
    }
  }
}

/// Select one workspace. The last selection wins, even when earlier health checks
/// are still running. Repeated selections of the same destination share its result.
/// Selects workspace `id` in the window, at its last page; this machine's at `page` where one is given
/// (`/workspaces…`, which a remote page's switcher and the menu lead to).
pub fn open(app: &AppHandle, id: &str, handed_over: bool, waiter: Option<OpenWaiter>, page: Option<String>) -> Result<(), String> {
  let state = shell(app);
  let origin = state.desks.lock().unwrap().get(id).ok_or("unknown")?.origin.clone();
  let (turn, revision, in_place) = {
    let mut views = state.views.lock().unwrap();
    if !handed_over {
      views.restore = None;
    }
    if let Some(pending) = views.pending.as_mut().filter(|p| p.matches(id, page.as_deref())) {
      pending.waiters.extend(waiter);
      return Ok(());
    }
    views.cancel();
    let active = views.active.as_ref().filter(|v| v.desk == id && (id != LOCAL || v.own == Own::Local(views.local_port)));
    if active.is_some() && page.is_none() {
      if let Some(waiter) = waiter {
        let _ = waiter.try_send(Ok(()));
      }
      drop(views);
      crate::menu::refresh(app);
      return Ok(());
    }
    let in_place = active.and_then(|v| Some((v.label.clone(), v.own.origin()?)));
    views.pending = Some(Selection { desk: id.into(), page: page.clone(), in_place: in_place.is_some(), waiters: waiter.into_iter().collect() });
    (views.turn, views.revision(id), in_place)
  };
  crate::menu::refresh(app);

  if let (Some((label, origin)), Some(page)) = (in_place, page.as_ref()) {
    open_local_page(app.clone(), state, turn, label, origin, page.clone());
    return Ok(());
  }

  let id = id.to_string();
  let app = app.clone();
  thread::spawn(move || {
    let health = origin.as_deref().map(remote::health);
    loop {
      if state.views.lock().unwrap().turn != turn {
        return;
      }
      let outgoing = if origin.is_none() && state.local_port().is_none() {
        Err("unreachable".into())
      } else {
        capture_after(&app, turn, OnBack::Cancel, origin.is_none(), |waited| {
          if let Some(origin) = &origin {
            // An attachment decision may take arbitrarily long. Refresh the probe
            // while the outgoing page is still visible, then sample its drafts.
            let checked = if waited { remote::health(origin).code() } else { health.as_ref().map_or("unreachable", Health::code) };
            Ok((Some(checked), None))
          } else {
            // The local server can stop or move while the outgoing page waits.
            let (port, next) = {
              let views = state.views.lock().unwrap();
              let next = page.clone().unwrap_or_else(|| views.parked.get(&id).map_or_else(|| "/".into(), |p| p.next.clone()));
              (views.local_port, next)
            };
            Ok((None, Some((port, port.and_then(|port| crate::sign_in_link(port, &next, false))))))
          }
        })
      };
      let (state, id, origin) = (state.clone(), id.clone(), origin.clone());
      let pending = state.clone();
      let queued = tauri::async_runtime::block_on(on_ui(app.clone(), move |app| {
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
          let (outgoing, (health, local)) = outgoing?;
          let (own, url, problem) = match origin {
            Some(origin) => {
              let problem = health.filter(|h| *h != Health::Seismic.code());
              let url = if problem.is_some() { window::bundled_url("/status.html") } else {
                Url::parse(&format!("{origin}{next}")).map_err(|_| "address")?
              };
              (Own::Remote(origin), url, problem)
            }
            None => {
              let (asked, link) = local.ok_or("unreachable")?;
              if port != asked {
                return Err("moved".to_string());
              }
              (Own::Local(asked), Url::parse(&link.ok_or("unreachable")?).map_err(|_| "address")?, None)
            }
          };
          let target = Destination { desk: id, own, url, problem, handed_over };
          mount(app, target, turn, outgoing)
        })();
        if opened.as_ref().is_err_and(|e| e == "moved") {
          return Ok(false);
        }
        if let Err(error) = &opened {
          if error != "superseded" && error != "cancelled" {
            eprintln!("seismic: the workspace could not be selected: {error}");
          }
        }
        let mut views = state.views.lock().unwrap();
        if views.turn == turn {
          views.finish(opened.map_err(|e| match e.as_str() {
            "drafts" | "unreachable" | "superseded" | "cancelled" | "unknown" => e,
            _ => "window".into(),
          }));
        }
        Ok(true)
      }));
      match queued {
        // the local server answered at a new port meanwhile: ask that one
        Ok(false) => continue,
        Ok(true) => {}
        Err(_) => {
          let mut views = pending.views.lock().unwrap();
          if views.turn == turn {
            views.finish(Err("window".into()));
          }
        }
      }
      return;
    }
  });
  Ok(())
}

/// Ask the running UI to navigate in place. A queued evaluation can reach a blank,
/// sign-in or reloading document. Wait for the leave decision, then commit while
/// this request still owns the selection and report the navigation's outcome.
fn open_local_page(app: AppHandle, state: Arc<Shell>, turn: u64, label: String, origin: String, page: String) {
  let script = move |action: &str| format!(
    "location.origin === {} && window.seismicDeskPage?.({}, {}, {})",
    json!(origin), json!(page), json!(turn.to_string()), json!(action),
  );
  thread::spawn(move || {
    let mut deadline = Instant::now() + LOAD_PATIENCE;
    let mut action = "ask";
    let result = loop {
      let (send, receive) = mpsc::channel();
      let (state, label, script) = (state.clone(), label.clone(), script(action));
      let queued = tauri::async_runtime::block_on(on_ui(app.clone(), move |app| {
        let views = state.views.lock().unwrap();
        let active = views.active.as_ref().filter(|v| v.label == label && v.own == Own::Local(views.local_port));
        if views.turn != turn || crate::is_stopping(app) {
          return Err("superseded".into());
        }
        let active = active.ok_or("unreachable")?;
        if views.attaching_local || active.local_reloading.is_some_and(|since| since.elapsed() < LOAD_PATIENCE) {
          return Ok(false);
        }
        drop(views);
        let view = app.get_webview(&label).ok_or("window")?;
        Ok(view.eval_with_callback(script, move |value| { let _ = send.send(value); }).is_ok())
      }));
      let answer = match queued {
        Err(error) => break Err(error),
        Ok(true) => receive.recv_timeout(Duration::from_secs(1)).unwrap_or_default(),
        Ok(false) => String::new(),
      };
      match answer.as_str() {
        r#""opened""# => break Ok(()),
        r#""cancelled""# => break Err("cancelled".into()),
        r#""ready""# if action == "ask" => {
          action = "commit";
          continue;
        }
        r#""pending""# => deadline = Instant::now() + LOAD_PATIENCE,
        _ => action = "ask",
      }
      if Instant::now() >= deadline {
        break Err("window".into());
      }
      thread::sleep(Duration::from_millis(100));
    };
    if result.is_err() {
      let script = script("cancel");
      let _ = app.run_on_main_thread({
        let app = app.clone();
        move || {
          if let Some(view) = app.get_webview(&label) {
            let _ = view.eval(script);
          }
        }
      });
    }
    let mut views = state.views.lock().unwrap();
    if views.turn == turn {
      views.finish(result);
    }
  });
}

/// Start the paired workspace at its fresh login link.
fn open_paired(app: &AppHandle, id: &str, origin: &str, link: Url, outgoing: Capture) -> Result<(), String> {
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
  mount(app, Destination { desk: id.into(), own, url: link, problem: None, handed_over: false }, turn, outgoing)
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

/// A pending selection is still choosing which workspace will own the native window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RebuildRevision {
  pub draft_generation: u64,
  pub selection_turn: u64,
}

pub fn rebuild_revision(app: &AppHandle) -> Option<RebuildRevision> {
  let state = shell(app);
  let views = state.views.lock().unwrap();
  views.pending.is_none().then_some(RebuildRevision { draft_generation: views.draft_generation, selection_turn: views.turn })
}

pub fn page_loaded(app: &AppHandle, label: &str, url: &Url) {
  let shell = shell(app);
  let mut windows = shell.views.lock().unwrap();
  let Some(window) = windows.active.as_mut().filter(|v| v.label == label) else { return };
  let next = crate::next_of(url);
  if url.path() != "/login" {
    window.local_reloading = None;
  }
  if matches!(window.own, Own::Remote(_)) {
    if window.loading.is_none() || window.loading != window.committed_load {
      return;
    }
    // A proxy's own page (a maintenance redirect, say) must not become the route Try again opens:
    // the route counts once the document proves to be the workspace. A Finished event supersedes
    // even a verification already waiting for the server.
    let token = windows.load();
    let window = windows.active.as_mut().unwrap();
    window.loading = Some(token);
    window.committed_load = Some(token);
    window.visible_load = VisibleLoad::Checking;
    let (app, label) = (app.clone(), label.to_string());
    thread::spawn(move || verify_load(&app, &label, token));
    return;
  }
  if window.next != next {
    window.next = next;
    windows.draft_generation += 1;
  }
}

/// Only main-document starts reach this hook. Invalidate earlier checks synchronously,
/// while the old document may still be visible and the new response is on its way.
/// The address it starts at is the one asked for: a redirect arrives later and does not start a load.
pub fn navigation_started(app: &AppHandle, label: &str, url: &Url) {
  let state = shell(app);
  let token = {
    let mut views = state.views.lock().unwrap();
    if !views.active.as_ref().is_some_and(|v| v.label == label && matches!(v.own, Own::Remote(_))) {
      return;
    }
    let token = views.load();
    let view = views.active.as_mut().unwrap();
    view.loading = Some(token);
    // A login link is spent once used, and the bundled status page is no route at the origin.
    view.provisional = (view.own.at(url) && url.path() != "/login").then(|| crate::next_of(url));
    token
  };
  watch_load(app, label, token);
}

pub fn navigation_committed(app: &AppHandle, label: &str, url: &Url) {
  let state = shell(app);
  let mut views = state.views.lock().unwrap();
  let Some(view) = views.active.as_mut().filter(|v| v.label == label) else { return };
  if !matches!(view.own, Own::Remote(_)) {
    return;
  }
  if *url == window::bundled_url("/status.html") {
    // A status document is the result of a check. Back from it, however, is a
    // fresh navigation even while the previous problem is still recorded.
    view.loading = None;
    view.committed_load = None;
    view.visible_load = VisibleLoad::Settled;
  } else {
    view.committed_load = view.loading;
    view.visible_load = VisibleLoad::AwaitingFinish;
    view.requested = view.provisional.take();
  }
}

pub fn navigation_cancelled(app: &AppHandle, label: &str) {
  let state = shell(app);
  let (token, visible) = {
    let mut views = state.views.lock().unwrap();
    let Some(view) = views.active.as_mut().filter(|v|
      v.label == label && v.committed_load.is_some() && v.loading.is_some() && v.loading != v.committed_load
    ) else { return };
    // The document still visible keeps the route its own load asked for.
    view.provisional = None;
    let visible = view.visible_load;
    if visible == VisibleLoad::Settled {
      view.loading = None;
      return;
    }
    // The cancelled navigation never replaced the visible document. Resume its
    // verification under a fresh token so superseded workers still cannot act.
    let token = views.load();
    let view = views.active.as_mut().unwrap();
    view.loading = Some(token);
    view.committed_load = Some(token);
    (token, visible)
  };
  if visible == VisibleLoad::Checking {
    let (app, label) = (app.clone(), label.to_string());
    thread::spawn(move || verify_load(&app, &label, token));
  } else {
    watch_load(app, label, token);
  }
}

/// How long a workspace page may take before the shell looks at what its window shows. A failed
/// load can leave WebKit on the page before, without a Finished event.
const LOAD_PATIENCE: Duration = Duration::from_secs(15);

pub(super) fn watch_load(app: &AppHandle, label: &str, token: u64) {
  let (app, label) = (app.clone(), label.to_string());
  thread::spawn(move || {
    thread::sleep(LOAD_PATIENCE);
    verify_load(&app, &label, token);
  });
}

/// Finishing and timing out both check the document and the server. A main-document start
/// supersedes either check, including while the check is waiting on the network or webview.
fn verify_load(app: &AppHandle, label: &str, token: u64) {
  let state = shell(app);
  let origin = {
    let views = state.views.lock().unwrap();
    let Some(view) = views.active.as_ref().filter(|v| v.label == label && v.loading == Some(token)) else { return };
    let Own::Remote(origin) = view.own.clone() else { return };
    origin
  };
  let health = remote::health(&origin);
  let committed = {
    let views = state.views.lock().unwrap();
    let Some(view) = views.active.as_ref().filter(|v| v.label == label && v.loading == Some(token)) else { return };
    view.committed_load == Some(token)
  };
  let document = if committed && health == Health::Seismic {
    app.get_webview(label).and_then(|w| window::workspace_document(&w, &origin, Duration::from_secs(2)))
  } else {
    None
  };
  let label = label.to_string();
  let result = tauri::async_runtime::block_on(on_ui(app.clone(), move |app| {
    let state = shell(app);
    let mut views = state.views.lock().unwrap();
    let Some(view) = views.active.as_mut().filter(|v| v.label == label && v.loading == Some(token)) else {
      return Ok(());
    };
    // The old page can still be visible after a provisional load fails. A commit
    // racing the timeout needs a fresh sample instead of a verdict about that old page.
    if !committed && view.committed_load == Some(token) {
      let app = app.clone();
      thread::spawn(move || verify_load(&app, &label, token));
      return Ok(());
    }
    view.loading = None;
    if let Some((next, activation)) = document {
      view.revalidated = false;
      view.requested = None;
      let recovered = view.problem.take().is_some();
      view.visible_load = VisibleLoad::Settled;
      if view.remember_route(activation, next) {
        views.draft_generation += 1;
      }
      drop(views);
      if recovered {
        changed(app);
      }
      return Ok(());
    }
    let problem = if health == Health::Seismic { "notLoaded" } else { health.code() };
    let webview = app.get_webview(&label).ok_or("window")?;
    let shown = webview.url().ok();
    let at_origin = shown.as_ref().is_some_and(|url| view.own.at(url));
    if problem == "notLoaded" && committed && at_origin && !view.revalidated {
      // A plain navigation reuses what the proxy let the cache keep, a placeholder or a redirect
      // to one: fetch the workspace route past the cache, then open it (a reload where only the
      // fragment differs, which would not load the page again).
      view.revalidated = true;
      view.visible_load = VisibleLoad::Checking;
      let route = Url::parse(&format!("{origin}{}", view.retry_route())).map_err(|e| e.to_string())?;
      let token = views.load();
      views.active.as_mut().unwrap().loading = Some(token);
      drop(views);
      refresh_cache(app, webview, route, token);
      return Ok(());
    }
    view.problem = Some(problem);
    drop(views);
    let status = window::bundled_url("/status.html");
    // A failed retry can leave the status document in place. Refresh its
    // controls without adding another copy of the same page to history.
    if shown.as_ref() == Some(&status) {
      webview.reload().map_err(|e| e.to_string())?;
    } else {
      webview.navigate(status).map_err(|e| e.to_string())?;
    }
    changed(app);
    Ok(())
  }));
  if let Err(error) = result {
    eprintln!("seismic: the status page could not be shown: {error}");
  }
}

/// Warm the browser cache with its own credentials. The page only reports completion:
/// the shell checks ownership again on the UI thread before navigating.
fn refresh_cache(app: &AppHandle, webview: Webview, route: Url, token: u64) {
  let url = json!(route.as_str());
  let marker = format!("window.seismicCacheRefresh === {}", json!(token.to_string()));
  let refresh = format!(
    "if (location.origin === new URL({url}).origin) fetch({url}, {{ cache: 'reload', credentials: 'include', headers: {{ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }} }})\
      .catch(() => {{}}).finally(() => {{ window.seismicCacheRefresh = {}; }})",
    json!(token.to_string())
  );
  watch_load(app, webview.label(), token);
  if webview.eval(refresh).is_err() {
    return;
  }
  let app = app.clone();
  thread::spawn(move || {
    let label = webview.label();
    let deadline = Instant::now() + LOAD_PATIENCE;
    let state = shell(&app);
    let owns_load = |views: &Views| views.active.as_ref().is_some_and(|v| v.label == label && v.loading == Some(token));
    while Instant::now() < deadline && owns_load(&state.views.lock().unwrap()) {
      let (send, receive) = mpsc::channel();
      if webview.eval_with_callback(&marker, move |value| { let _ = send.send(value); }).is_err() {
        return;
      }
      if receive.recv_timeout(Duration::from_secs(1)).is_ok_and(|value| value == "true") {
        if let Err(error) = open_refreshed_route(&app, label, token, route) {
          eprintln!("seismic: the workspace could not be reloaded: {error}");
        }
        return;
      }
      thread::sleep(Duration::from_millis(100));
    }
  });
}

/// Keep the saved fragment even when the engine would treat Navigate as a
/// same-document move. Set the address first, then reload under the same guard.
fn open_refreshed_route(app: &AppHandle, label: &str, token: u64, route: Url) -> Result<(), String> {
  let label = label.to_string();
  let current_view = move |app: &AppHandle| {
    let state = shell(app);
    let views = state.views.lock().unwrap();
    views.active.as_ref()
      .filter(|v| v.label == label && v.loading == Some(token))
      .and_then(|_| app.get_webview(&label))
  };
  let target = route.clone();
  let (sent, updated) = mpsc::channel();
  let finish_reload = tauri::async_runtime::block_on(on_ui(app.clone(), {
    let current_view = current_view.clone();
    move |app| {
      let Some(webview) = current_view(app) else { return Ok(false); };
      let current = webview.url().map_err(|e| e.to_string())?;
      if current == target {
        webview.reload().map_err(|e| e.to_string())?;
        return Ok(false);
      }
      if current.path() != target.path() || current.query() != target.query() || current.origin() != target.origin()
      {
        webview.navigate(target).map_err(|e| e.to_string())?;
        return Ok(false);
      }
      let script = format!(
        "(() => {{ if (location.href !== {}) return false; history.replaceState(history.state, '', {}); return true; }})()",
        json!(current.as_str()), json!(target.as_str()),
      );
      webview.eval_with_callback(script, move |value| { let _ = sent.send(value); }).map_err(|e| e.to_string())?;
      Ok(true)
    }
  }))?;
  if finish_reload && updated.recv_timeout(Duration::from_secs(2)).is_ok_and(|value| value == "true") {
    tauri::async_runtime::block_on(on_ui(app.clone(), move |app| {
      if let Some(webview) = current_view(app).filter(|w| w.url().is_ok_and(|url| url == route)) {
        webview.reload().map_err(|e| e.to_string())?;
      }
      Ok(())
    }))?;
  }
  Ok(())
}

/// Only the remote capability for this exact window label and origin grants the checkpoint command.
pub fn departure(shell: &Shell, label: &str, activation: f64, url: &str, entries: Option<Vec<(String, String)>>, received: bool, workspace: bool) {
  let mut windows = shell.views.lock().unwrap();
  if let Some(window) = windows.active.as_mut().filter(|v| v.label == label) {
    let confirmed = received && window.departure.confirm(activation);
    let checkpoint = entries.is_some();
    let recorded = window.departure.receive(activation, entries);
    // Pagehide can precede the server probe. Its route and markers describe the
    // same departing document, even after a replacement has started loading.
    let accepts_route = match window.own {
      Own::Remote(_) => checkpoint && workspace,
      Own::Local(_) => activation == window.departure.activation,
    };
    if recorded && accepts_route {
      if let Ok(url) = Url::parse(url) {
        if window.own.at(&url) {
          window.remember_route(activation, crate::next_of(&url));
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

pub fn settle_departure(shell: &Shell, label: &str, activation: f64) {
  let mut windows = shell.views.lock().unwrap();
  if windows.active.as_mut().filter(|v| v.label == label).is_some_and(|w| w.departure.settle(activation)) {
    windows.draft_generation += 1;
  }
}

/// Let the displayed page and the native menu refresh after a selection or list change.
pub fn changed(app: &AppHandle) {
  if let Some(w) = active_view(app) {
    let _ = w.eval("window.dispatchEvent(new Event('seismic-desks'))");
  }
  crate::menu::refresh(app);
}

/// Capture the native window once and keep the drafts and routes of the parked workspaces.
pub fn placed(app: &AppHandle, draft_generation: u64, mut drafts: HashMap<String, window::drafts::Sample>) -> io::Result<Option<Vec<Placed>>> {
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
      let Some(sample) = drafts.remove(&active.label) else { return Ok(None) };
      Some(sample)
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
  fn capture_accepts_a_live_workspace_route_during_verification() {
    let view = WorkspaceView {
      label: "desk-1".into(), desk: "studio".into(), own: Own::Remote("https://studio".into()), next: "/p/lab".into(), provisional: None, requested: None,
      problem: None, drafts: vec![], draft_checkpoint: None, awaiting_drafts: false, departure: Departure::default(),
      route_activation: 0.0, loading: Some(1), committed_load: None, visible_load: VisibleLoad::Settled, local_reloading: None, revalidated: false,
    };
    let sample = |workspace, next: &str| Some(window::drafts::Sample {
      next: next.into(), entries: vec![("seismic-drafts-lab".into(), "kept".into())], workspace,
    });
    let saved = saved_view(&view, sample(false, "/maintenance")).unwrap();
    assert_eq!((saved.next.as_str(), saved.drafts.len()), ("/p/lab", 1));
    assert_eq!(saved_view(&view, sample(true, "/p/new")).unwrap().next, "/p/new");
    let mut view = view;
    assert!(view.remember_route(2.0, "/p/new".into()));
    assert!(!view.remember_route(1.0, "/p/old".into()));
    assert_eq!(view.next, "/p/new");
  }

  #[test]
  fn recovery_retries_the_failed_route_while_restoration_keeps_the_verified_one() {
    let mut view = WorkspaceView {
      label: "desk-1".into(), desk: "studio".into(), own: Own::Remote("https://studio".into()), next: "/p/lab".into(), provisional: None, requested: None,
      problem: Some("notLoaded"), drafts: vec![], draft_checkpoint: None, awaiting_drafts: false, departure: Departure::default(),
      route_activation: 0.0, loading: None, committed_load: None, visible_load: VisibleLoad::Settled, local_reloading: None, revalidated: false,
    };
    assert_eq!(view.retry_route(), "/p/lab");
    view.requested = Some("/p/lab/feedback".into());
    assert_eq!(view.retry_route(), "/p/lab/feedback");
    assert_eq!(saved_view(&view, None).unwrap().next, "/p/lab");
  }

  #[test]
  fn status_keeps_the_saved_drafts_when_the_first_document_never_runs() {
    let mut view = WorkspaceView {
      label: "desk-1".into(), desk: "studio".into(), own: Own::Remote("https://studio".into()), next: "/p/lab".into(), provisional: None, requested: None,
      problem: Some("notLoaded"), drafts: vec![("seismic-drafts-lab".into(), "saved".into())], draft_checkpoint: None,
      awaiting_drafts: true, departure: Departure::default(), route_activation: 0.0, loading: None, committed_load: None, visible_load: VisibleLoad::Settled, local_reloading: None, revalidated: false,
    };
    let saved = saved_view(&view, None).unwrap();
    assert_eq!(saved.drafts, view.drafts);
    assert_eq!(saved.next, view.next);
    view.departure.receive(1.0, None);
    assert_eq!(saved_view(&view, None).err().as_deref(), Some("drafts"));
  }

  #[test]
  fn status_needs_the_latest_documents_departure_even_when_its_drafts_are_empty() {
    let mut departure = Departure::default();
    assert!(departure.receive(1.0, Some(vec![("seismic-drafts-shop".into(), "old".into())])));
    assert!(departure.receive(2.0, None));
    assert!(departure.activation == 2.0 && departure.drafts.is_none());
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
  fn a_late_checkpoint_fills_only_what_the_settled_page_lacks() {
    let mut departure = Departure::default();
    let draft = |v: &str| ("seismic-drafts-shop".to_string(), v.to_string());
    let wish = |v: &str| ("seismic-wish-shop".to_string(), v.to_string());
    assert!(departure.receive(1.0, None));
    assert!(departure.receive(2.0, None));
    assert_eq!(departure.restore(2.0), Err("pending"));
    // The returning page stops waiting, then the previous page's checkpoint arrives.
    assert!(departure.settle(2.0));
    assert!(departure.receive(1.0, Some(vec![draft("older"), wish("unfinished")])));
    let view = |departure: &Departure| WorkspaceView {
      label: "desk-1".into(), desk: "studio".into(), own: Own::Remote("https://studio".into()), next: "/".into(), provisional: None, requested: None,
      problem: None, drafts: vec![], draft_checkpoint: None, awaiting_drafts: false, departure: departure.clone(), route_activation: 0.0, loading: None, committed_load: None, visible_load: VisibleLoad::Settled, local_reloading: None, revalidated: false,
    };
    // A relaunch while that page is open keeps its newer edit and the draft it lacks.
    let saved = saved_view(&view(&departure), Some(window::drafts::Sample { next: "/".into(), entries: vec![draft("newer")], workspace: true })).unwrap();
    assert_eq!(saved.drafts, vec![draft("newer"), wish("unfinished")]);
    // So do Back and Try again.
    assert!(departure.receive(2.0, Some(vec![draft("newer")])));
    assert_eq!(saved_view(&view(&departure), None).unwrap().drafts, vec![draft("newer"), wish("unfinished")]);
    assert!(departure.receive(3.0, None));
    assert_eq!(departure.restore(3.0), Ok(Some((None, vec![draft("newer"), wish("unfinished")]))));
  }

  #[test]
  fn a_page_still_waiting_takes_the_copy_over_its_stored_drafts() {
    let mut departure = Departure::default();
    let draft = |v: &str| ("seismic-drafts-shop".to_string(), v.to_string());
    assert!(departure.receive(1.0, Some(vec![draft("in memory")])));
    // The next page leaves before its editors start, with what its session store held.
    assert!(departure.receive(2.0, None));
    assert!(departure.receive(2.0, Some(vec![draft("stored")])));
    assert!(departure.receive(3.0, None));
    assert_eq!(departure.restore(3.0), Ok(Some((Some(1.0), vec![draft("in memory")]))));
    // A settle message can overtake its page's activation.
    let mut departure = Departure::default();
    assert!(departure.receive(1.0, Some(vec![draft("older")])));
    assert!(departure.settle(2.0));
    assert!(departure.receive(2.0, None));
    assert!(departure.receive(2.0, Some(vec![draft("newer")])));
    assert!(departure.receive(3.0, None));
    assert_eq!(departure.restore(3.0), Ok(Some((None, vec![draft("newer")]))));
  }

  #[test]
  fn each_origin_gets_one_capability_family() {
    assert_ne!(family("a", "https://studio.lab"), family("b", "https://studio-lab"));
    assert_eq!(family("a", "https://[fd7a::2]:4417"), family("b", "https://[fd7a::2]:4417"));
    assert_ne!(family(LOCAL, "http://localhost"), family("a", "http://localhost"));
    assert_ne!(family(LOCAL, "http://127.0.0.1:4417"), family(LOCAL, "http://127.0.0.1:4418"));
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
    views.pending = Some(Selection { desk: "studio".into(), page: None, in_place: false, waiters: vec![send] });
    let studio_turn = views.turn;
    views.cancel();
    assert_ne!(views.turn, studio_turn);
    assert_eq!(receive.try_recv().unwrap(), Err("superseded".into()));
    assert!(views.pending.is_none());
  }

  #[test]
  fn only_identical_destinations_share_a_pending_switch() {
    let plain = Selection { desk: LOCAL.into(), page: None, in_place: false, waiters: vec![] };
    assert!(plain.matches(LOCAL, None));
    assert!(!plain.matches(LOCAL, Some("/workspaces?new")));

    let settings = Selection { desk: LOCAL.into(), page: Some("/workspaces?edit=studio".into()), in_place: false, waiters: vec![] };
    assert!(settings.matches(LOCAL, Some("/workspaces?edit=studio")));
    assert!(!settings.matches(LOCAL, Some("/workspaces?edit=buildbox")));
    assert!(!settings.matches(LOCAL, Some("/workspaces?new")));
    assert!(!settings.matches(LOCAL, None));
    assert!(!settings.matches("studio", Some("/workspaces?edit=studio")));
  }
}
