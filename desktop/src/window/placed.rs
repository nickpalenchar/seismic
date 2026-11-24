// Relaunch state: one native placement, the selected workspace, and routes and drafts for
// workspaces previously visited. Older multi-window snapshots remain readable.

use std::{
  fs,
  io::{self, Write},
  path::{Path, PathBuf},
  time::Duration,
};

use serde_json::{json, Value};
use tauri::{LogicalPosition, LogicalSize, Window};
use uuid::Uuid;

use crate::{desks::LOCAL, now_ms};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Placed {
  /// This record owns the single native window. Older snapshots used the focused window.
  pub primary: bool,
  /// The workspace's id on the list.
  pub desk: String,
  /// A remote one's origin: reopened only while the workspace is still there.
  pub origin: Option<String>,
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
  pub maximized: bool,
  pub fullscreen: bool,
  /// Minimized windows may be reported as visible or hidden, depending on the platform.
  pub minimized: bool,
  /// Shown: closed on a Mac, this machine's window is hidden while the app stays in the Dock.
  pub visible: bool,
  /// The page it showed at its origin.
  pub next: String,
  /// The window the owner was in.
  pub focused: bool,
  /// Unsent work sampled from a live workspace, independent of its server handover.
  pub drafts: Vec<(String, String)>,
  /// Identifies the last workspace document's draft copy when the window is showing status.
  pub draft_checkpoint: Option<Uuid>,
}

const FILE: &str = "app-windows.json";
const REBUILD: &str = "app-windows.json.rebuild";
const REBUILD_PART: &str = "app-windows.json.rebuild.part";
pub const REBUILD_ARG: &str = "--seismic-rebuild=";
const FORMER: &str = "app-window.json";
/// How old the file may be: starting again takes seconds, a start much later opens the windows afresh.
const FRESH: Duration = Duration::from_secs(60);
/// A Windows installer can spend several minutes replacing the app before starting it again.
const INSTALL_FRESH: Duration = Duration::from_secs(30 * 60);

impl Placed {
  pub fn layout(w: &Window) -> Option<Placed> {
    let minimized = w.is_minimized().unwrap_or(false);
    let (at, size) = bounds(w, minimized)?;
    Some(Placed {
      primary: true,
      desk: LOCAL.into(),
      x: at.x,
      y: at.y,
      width: size.width,
      height: size.height,
      maximized: w.is_maximized().unwrap_or(false),
      fullscreen: w.is_fullscreen().unwrap_or(false),
      minimized,
      visible: w.is_visible().unwrap_or(true),
      next: "/".into(),
      focused: w.is_focused().unwrap_or(false),
      ..Default::default()
    })
  }

  fn json(&self) -> Value {
    let mut value = json!({
      "primary": self.primary, "desk": self.desk, "origin": self.origin, "x": self.x, "y": self.y, "width": self.width, "height": self.height,
      "maximized": self.maximized, "fullscreen": self.fullscreen, "minimized": self.minimized,
      "visible": self.visible, "next": self.next, "focused": self.focused,
    });
    if !self.drafts.is_empty() {
      value["drafts"] = json!(self.drafts);
    }
    if let Some(checkpoint) = self.draft_checkpoint {
      value["draftCheckpoint"] = json!(checkpoint.to_string());
    }
    value
  }

  fn read(v: &Value) -> Option<Placed> {
    let n = |k: &str| v[k].as_f64();
    let b = |k: &str| v[k].as_bool().unwrap_or(false);
    Some(Placed {
      primary: b("primary"),
      desk: v["desk"].as_str().unwrap_or(LOCAL).to_string(),
      origin: v["origin"].as_str().map(String::from),
      x: n("x")?,
      y: n("y")?,
      width: n("width")?,
      height: n("height")?,
      maximized: b("maximized"),
      fullscreen: b("fullscreen"),
      minimized: b("minimized"),
      visible: v["visible"].as_bool().unwrap_or(true),
      next: v["next"].as_str().filter(|n| n.starts_with('/')).unwrap_or("/").to_string(),
      focused: b("focused"),
      drafts: serde_json::from_value(v["drafts"].clone()).unwrap_or_default(),
      draft_checkpoint: v["draftCheckpoint"].as_str().and_then(|id| Uuid::parse_str(id).ok()),
    })
  }
}

fn bounds(w: &Window, minimized: bool) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
  #[cfg(windows)]
  if minimized {
    return restored_bounds(w);
  }
  #[cfg(not(windows))]
  let _ = minimized;
  let scale = w.scale_factor().ok()?;
  Some((w.outer_position().ok()?.to_logical(scale), w.inner_size().ok()?.to_logical(scale)))
}

#[cfg(windows)]
fn restored_bounds(w: &Window) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
  use windows_sys::Win32::{
    Foundation::RECT,
    UI::{HiDpi::AdjustWindowRectExForDpi, WindowsAndMessaging::*},
  };
  let hwnd = w.hwnd().ok()?.0;
  let mut placement = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
  if unsafe { GetWindowPlacement(hwnd, &mut placement) } == 0 {
    return None;
  }
  // The minimized window's live bounds can belong to its taskbar icon. Use the restore rectangle,
  // converted from workspace to screen coordinates and from frame size to content size.
  let monitor = w.current_monitor().ok()??;
  let scale = monitor.scale_factor();
  let rect = placement.rcNormalPosition;
  let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32 & !(WS_MINIMIZE | WS_MAXIMIZE);
  let ex = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
  let mut frame = RECT::default();
  let menu = !unsafe { GetMenu(hwnd) }.is_null();
  if unsafe { AdjustWindowRectExForDpi(&mut frame, style, menu.into(), ex, (scale * 96.0).round() as u32) } == 0 {
    return None;
  }
  let mut at = tauri::PhysicalPosition::new(rect.left, rect.top);
  if ex & WS_EX_TOOLWINDOW == 0 {
    at.x += monitor.work_area().position.x - monitor.position().x;
    at.y += monitor.work_area().position.y - monitor.position().y;
  }
  let width = (rect.right - rect.left) - (frame.right - frame.left);
  let height = (rect.bottom - rect.top) - (frame.bottom - frame.top);
  let size = tauri::PhysicalSize::new(width.max(1) as u32, height.max(1) as u32);
  Some((at.to_logical(scale), size.to_logical(scale)))
}

#[cfg(test)]
pub fn keep(home: &Path, windows: &[Placed], installer: bool) -> io::Result<()> {
  stage(home, windows, installer)?.publish(home)
}

pub fn stage(home: &Path, windows: &[Placed], installer: bool) -> io::Result<Staged> {
  check_destination(home)?;
  stage_at(home.join("app-windows.json.part"), windows, installer, None)
}

/// Finish all filesystem work before deciding whether to restart. Only the
/// replacement process given this ticket is allowed to restore the snapshot.
pub fn publish_rebuild(home: &Path, windows: &[Placed]) -> io::Result<RebuildSnapshot> {
  let ticket = Uuid::new_v4();
  let file = stage_at(home.join(REBUILD_PART), windows, false, Some(ticket))?
    .publish_with_handle(home.join(REBUILD))?;
  Ok(RebuildSnapshot { ticket, file: Some(file) })
}

pub struct RebuildSnapshot {
  ticket: Uuid,
  file: Option<PublishedSnapshot>,
}

impl RebuildSnapshot {
  pub fn ticket(&self) -> Uuid {
    self.ticket
  }

  pub fn hand_over(mut self) {
    // Startup takes responsibility for removing the file once we request a relaunch.
    self.file.take();
  }
}

impl Drop for RebuildSnapshot {
  fn drop(&mut self) {
    if let Some(file) = self.file.take() {
      if let Err(error) = file.discard() {
        eprintln!("seismic: cannot discard canceled rebuild snapshot: {error}");
      }
    }
  }
}

pub fn rebuild_ticket() -> Option<Uuid> {
  std::env::args_os().skip(1).filter_map(|arg| {
    Uuid::parse_str(arg.to_str()?.strip_prefix(REBUILD_ARG)?).ok()
  }).last()
}

pub struct Staged(Option<PathBuf>);

impl Staged {
  pub fn publish(self, home: &Path) -> io::Result<()> {
    self.publish_to(&home.join(FILE))
  }

  fn publish_to(mut self, destination: &Path) -> io::Result<()> {
    fs::rename(self.0.as_ref().unwrap(), destination)?;
    self.0.take();
    Ok(())
  }

  pub fn publish_for_installer(self, home: &Path) -> io::Result<PublishedSnapshot> {
    self.publish_with_handle(home.join(FILE))
  }

  fn publish_with_handle(self, path: PathBuf) -> io::Result<PublishedSnapshot> {
    // Keep a writable handle so we can invalidate the contents if the installer returns,
    // even if the directory or file permissions have since changed.
    let file = fs::OpenOptions::new().write(true).open(self.0.as_ref().unwrap())?;
    self.publish_to(&path)?;
    Ok(PublishedSnapshot { path, file })
  }
}

impl Drop for Staged {
  fn drop(&mut self) {
    if let Some(path) = self.0.take() {
      if let Err(error) = remove_snapshot(&path) {
        eprintln!("seismic: cannot remove staged restart snapshot: {error}");
      }
    }
  }
}

/// A deferred automatic rebuild checks storage before asking the local server to stop again.
pub fn probe_write(home: &Path, windows: &[Placed]) -> io::Result<()> {
  check_destination(home)?;
  let mut probe = stage_at(home.join("app-windows.json.probe"), windows, false, None)?;
  remove_snapshot(&probe.0.take().unwrap())
}

fn check_destination(home: &Path) -> io::Result<()> {
  match fs::symlink_metadata(home.join(FILE)) {
    Ok(meta) if meta.is_dir() => Err(io::Error::other("the restart snapshot destination is a directory")),
    #[cfg(windows)]
    Ok(meta) if meta.permissions().readonly() => Err(io::Error::other("the restart snapshot is read-only")),
    Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
    _ => Ok(()),
  }
}

fn stage_at(path: PathBuf, windows: &[Placed], installer: bool, ticket: Option<Uuid>) -> io::Result<Staged> {
  let all: Vec<Value> = windows.iter().map(Placed::json).collect();
  let mut snapshot = json!({ "at": now_ms(), "installer": installer, "windows": all });
  if let Some(ticket) = ticket {
    snapshot["ticket"] = json!(ticket.to_string());
  }
  let text = snapshot.to_string();
  let mut options = fs::OpenOptions::new();
  options.write(true).create_new(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  // Discard a partial snapshot from an interrupted write.
  remove_snapshot(&path)?;
  let mut file = options.open(&path)?;
  if let Err(error) = file.write_all(text.as_bytes()).and_then(|()| file.sync_all()) {
    if let Err(cleanup) = (PublishedSnapshot { path, file }).discard() {
      eprintln!("seismic: cannot discard partial restart snapshot: {cleanup}");
    }
    return Err(error);
  }
  Ok(Staged(Some(path)))
}

/// Read the explicitly selected workspace, or migrate the focused legacy window.
pub fn primary(saved: &[Placed]) -> Option<&Placed> {
  saved.iter().find(|p| p.primary)
    .or_else(|| saved.iter().find(|p| p.focused && p.visible && !p.minimized))
    .or_else(|| saved.iter().find(|p| p.desk == LOCAL))
    .or_else(|| saved.first())
}

/// The windows the shell before this one left, this machine's first; none where it left none lately.
pub fn take(home: &Path) -> Vec<Placed> {
  take_for_launch(home, rebuild_ticket())
}

pub fn take_for_launch(home: &Path, ticket: Option<Uuid>) -> Vec<Placed> {
  let windows = read_saved_for_launch(home, true, ticket);
  // Only the primary instance can clean up files left by an interrupted attempt.
  for name in [REBUILD, REBUILD_PART] {
    let path = home.join(name);
    if let Err(error) = clean_rebuild_file(path) {
      eprintln!("seismic: cannot clean up rebuild snapshot: {error}");
    }
  }
  windows
}

fn remove_snapshot(path: &Path) -> io::Result<()> {
  match fs::remove_file(path) {
    Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
    _ => Ok(()),
  }
}

fn clean_rebuild_file(path: PathBuf) -> io::Result<()> {
  let Err(remove_error) = remove_snapshot(&path) else { return Ok(()) };
  if !fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_file()) {
    return Err(remove_error);
  }
  let file = fs::OpenOptions::new().write(true).open(path)?;
  file.set_len(0).and_then(|()| file.sync_all())
}

pub struct PublishedSnapshot {
  path: PathBuf,
  file: fs::File,
}

impl PublishedSnapshot {
  /// Use the retained handle if the directory no longer permits removing the file.
  pub fn discard(self) -> io::Result<()> {
    let Err(remove_error) = remove_snapshot(&self.path) else { return Ok(()) };
    self.file.set_len(0).and_then(|()| self.file.sync_all())
      .map_err(|error| io::Error::other(format!("cannot remove restart snapshot: {remove_error}; cannot invalidate it: {error}")))
  }
}

/// The builder needs the initial visibility on macOS before the single-instance check runs.
#[cfg(target_os = "macos")]
pub fn peek(home: &Path) -> Vec<Placed> {
  read_saved_for_launch(home, false, rebuild_ticket())
}

#[cfg(test)]
fn read_saved(home: &Path, consume: bool) -> Vec<Placed> {
  read_saved_for_launch(home, consume, None)
}

fn read_saved_for_launch(home: &Path, consume: bool, ticket: Option<Uuid>) -> Vec<Placed> {
  let read = |name: &str| {
    let path = home.join(name);
    let text = fs::read_to_string(&path).ok()?;
    if consume {
      let _ = fs::remove_file(&path);
    }
    serde_json::from_str::<Value>(&text).ok()
  };
  // A Windows installer can forward the previous launch's arguments. Its own
  // handover takes priority over a checkout snapshot from an earlier launch.
  let (now, former) = (read(FILE), read(FORMER));
  let rebuild = ticket.and_then(|ticket| {
    let text = fs::read_to_string(home.join(REBUILD)).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    (value["ticket"].as_str().and_then(|s| Uuid::parse_str(s).ok()) == Some(ticket)).then_some(value)
  });
  let fresh = |v: &Value| {
    let max = if v["installer"] == true { INSTALL_FRESH } else { FRESH };
    v["at"].as_u64().is_some_and(|at| now_ms().saturating_sub(at) <= max.as_millis() as u64)
  };
  let now = now.filter(fresh);
  let current = if now.as_ref().is_some_and(|v| v["installer"] == true) {
    now
  } else {
    rebuild.filter(fresh).or(now)
  };
  let mut windows: Vec<Placed> = match (current, former.filter(fresh)) {
    (Some(v), _) => v["windows"].as_array().map(|a| a.iter().filter_map(Placed::read).collect()).unwrap_or_default(),
    (None, Some(v)) => Placed::read(&v).into_iter().collect(),
    (None, None) => vec![],
  };
  windows.sort_by_key(|p| p.desk != LOCAL);
  windows.dedup_by(|a, b| a.desk == b.desk);
  windows
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_selected_workspace_takes_precedence_over_legacy_window_focus() {
    let local = Placed { desk: LOCAL.into(), focused: true, visible: true, ..Default::default() };
    let mut remote = Placed { desk: "studio".into(), primary: true, ..Default::default() };
    assert_eq!(primary(&[local.clone(), remote.clone()]).map(|p| p.desk.as_str()), Some("studio"));
    remote.primary = false;
    assert_eq!(primary(&[local, remote]).map(|p| p.desk.as_str()), Some(LOCAL));
  }

  #[test]
  fn a_retry_probe_leaves_published_placements_alone_and_checks_a_blocked_target() {
    let home = home("retry-probe");
    let path = home.join(FILE);
    fs::create_dir(&path).unwrap();
    assert!(probe_write(&home, &[]).is_err());
    fs::remove_dir(&path).unwrap();
    probe_write(&home, &[]).unwrap();
    assert!(!path.exists());
    keep(&home, &[], true).unwrap();
    let previous = fs::read(&path).unwrap();
    probe_write(&home, &[Placed { next: "/probe".into(), ..Default::default() }]).unwrap();
    assert_eq!(fs::read(path).unwrap(), previous);
    assert!(!home.join("app-windows.json.probe").exists());
    fs::remove_dir_all(home).unwrap();
  }

  #[test]
  fn only_the_primary_launch_cleans_up_an_interrupted_rebuild() {
    let home = home("abandoned-rebuild");
    let windows = [Placed { desk: LOCAL.into(), visible: true, focused: true, next: "/p/abandoned".into(), ..Default::default() }];
    let abandoned = publish_rebuild(&home, &windows).unwrap();
    let abandoned_ticket = abandoned.ticket();
    // Model an interruption after publication, before the old process can clean up.
    abandoned.hand_over();
    fs::write(home.join(REBUILD_PART), "partial draft").unwrap();
    assert!(read_saved(&home, false).is_empty());
    assert!(home.join(REBUILD).is_file());
    assert!(home.join(REBUILD_PART).is_file());
    assert!(take(&home).is_empty());
    assert!(!home.join(REBUILD).exists());
    assert!(!home.join(REBUILD_PART).exists());
    let replacement = publish_rebuild(&home, &windows).unwrap();
    let new_ticket = replacement.ticket();
    replacement.hand_over();
    assert!(read_saved_for_launch(&home, false, Some(abandoned_ticket)).is_empty());
    assert_eq!(read_saved_for_launch(&home, false, Some(new_ticket)), windows);
    assert_eq!(take_for_launch(&home, Some(new_ticket)), windows);
    assert!(take_for_launch(&home, Some(new_ticket)).is_empty());
    fs::remove_dir_all(home).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn canceling_a_rebuild_clears_drafts_when_unlink_is_denied() {
    use std::os::unix::fs::PermissionsExt;

    let home = home("rebuild-canceled");
    let windows = [Placed { drafts: vec![("seismic-drafts-note".into(), "unsent".into())], ..Default::default() }];
    let snapshot = publish_rebuild(&home, &windows).unwrap();
    let path = home.join(REBUILD);
    assert!(fs::read_to_string(&path).unwrap().contains("unsent"));
    let permissions = fs::metadata(&home).unwrap().permissions();
    fs::set_permissions(&home, fs::Permissions::from_mode(0o500)).unwrap();
    drop(snapshot);
    let contents = fs::read(&path);
    fs::set_permissions(&home, permissions).unwrap();

    match contents {
      Ok(bytes) => assert!(bytes.is_empty()),
      Err(error) => assert_eq!(error.kind(), io::ErrorKind::NotFound),
    }
    fs::remove_dir_all(home).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn a_returned_installer_invalidates_its_snapshot_when_unlink_is_denied() {
    use std::os::unix::fs::PermissionsExt;

    let home = home("installer-discard");
    let windows = [Placed { desk: LOCAL.into(), visible: true, next: "/p/installing".into(), ..Default::default() }];
    let installer = stage(&home, &windows, true).unwrap().publish_for_installer(&home).unwrap();
    let path = home.join(FILE);
    assert_eq!(read_saved(&home, false), windows);

    let permissions = fs::metadata(&home).unwrap().permissions();
    fs::set_permissions(&home, fs::Permissions::from_mode(0o500)).unwrap();
    let discarded = installer.discard();
    let contents = fs::read(&path);
    fs::set_permissions(&home, permissions).unwrap();

    discarded.unwrap();
    match contents {
      Ok(bytes) => assert!(bytes.is_empty()),
      // A privileged test user can unlink the file despite the directory permissions.
      Err(error) => assert_eq!(error.kind(), io::ErrorKind::NotFound),
    }
    assert!(read_saved(&home, false).is_empty());
    assert!(take(&home).is_empty());
    fs::remove_dir_all(home).unwrap();
  }

  fn home(name: &str) -> std::path::PathBuf {
    let home = std::env::temp_dir().join(format!("seismic-placed-{name}-{}", now_ms()));
    fs::create_dir_all(&home).unwrap();
    home
  }

  #[test]
  fn the_windows_come_back_once_this_machines_first() {
    let home = home("all");
    let remote = Placed {
      desk: "a".into(),
      origin: Some("https://studio".into()),
      width: 900.0,
      height: 700.0,
      next: "/p/x".into(),
      visible: true,
      ..Default::default()
    };
    let local = Placed {
      desk: LOCAL.into(),
      width: 1440.0,
      height: 900.0,
      minimized: true,
      visible: false,
      next: "/".into(),
      ..Default::default()
    };
    keep(&home, &[remote.clone(), local.clone()], false).unwrap();
    assert_eq!(take(&home), vec![local, remote]);
    assert_eq!(take(&home), vec![]);
    let _ = fs::remove_dir_all(&home);
  }

  #[test]
  fn an_installer_relaunch_restores_remote_windows_and_drafts_after_a_long_install() {
    let home = home("installer");
    let remote = Placed {
      desk: "lab".into(),
      origin: Some("https://lab".into()),
      next: "/p/lab".into(),
      drafts: vec![("seismic-drafts-project".into(), "unsent".into())],
      draft_checkpoint: Some(Uuid::new_v4()),
      ..Default::default()
    };
    keep(&home, &[remote.clone()], true).unwrap();
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      assert_eq!(fs::metadata(home.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let file = home.join(FILE);
    let mut snapshot: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    snapshot["at"] = json!(now_ms() - 5 * 60_000);
    fs::write(file, snapshot.to_string()).unwrap();
    // Reading placement before instance arbitration must leave the snapshot available.
    assert_eq!(read_saved(&home, false), vec![remote.clone()]);
    assert_eq!(take(&home), vec![remote]);
    assert!(take(&home).is_empty());
    let _ = fs::remove_dir_all(home);
  }

  #[test]
  fn a_snapshot_is_fresh_again_after_an_installer_error_dialog() {
    let home = home("installer-dialog");
    let placements = [Placed {
      desk: "lab".into(),
      origin: Some("https://lab".into()),
      next: "/p/lab".into(),
      drafts: vec![("seismic-drafts-lab".into(), "unsent".into())],
      ..Default::default()
    }];
    keep(&home, &placements, true).unwrap();
    let file = home.join(FILE);
    let mut snapshot: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    snapshot["at"] = json!(now_ms() - INSTALL_FRESH.as_millis() as u64 - 1);
    fs::write(file, snapshot.to_string()).unwrap();
    assert!(read_saved(&home, false).is_empty());

    keep(&home, &placements, false).unwrap();
    assert_eq!(take(&home), placements);
    let _ = fs::remove_dir_all(home);
  }

  #[test]
  fn a_former_shells_window_is_this_machines() {
    let home = home("former");
    let former = json!({ "at": now_ms(), "x": 1.0, "y": 2.0, "width": 800.0, "height": 600.0, "maximized": true, "visible": true, "next": "/x" });
    fs::write(home.join(FORMER), former.to_string()).unwrap();
    let taken = take(&home);
    assert_eq!(taken.len(), 1);
    assert_eq!((taken[0].desk.as_str(), taken[0].next.as_str(), taken[0].maximized), (LOCAL, "/x", true));
    assert!(!taken[0].minimized);
    let _ = fs::remove_dir_all(&home);
  }

  #[test]
  fn a_stale_file_brings_nothing_back() {
    let home = home("stale");
    fs::write(
      home.join(FILE),
      json!({ "at": 1, "windows": [{ "desk": "local", "x": 0, "y": 0, "width": 1, "height": 1 }] }).to_string(),
    )
    .unwrap();
    assert_eq!(take(&home), vec![]);
    assert!(!home.join(FILE).exists());
    let _ = fs::remove_dir_all(&home);
  }
}
