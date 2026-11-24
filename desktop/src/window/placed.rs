// The windows as the shell left them to start again (main.rs, `relaunch`), for the new one to open
// them the same: which workspace each showed, where it stood and how large, the page at its origin.
// A file in the home, taken once and only fresh. A shell from before the workspaces wrote its one
// window to `app-window.json`, which counts as this machine's.

use std::{
  fs,
  io::{self, Write},
  path::Path,
  time::Duration,
};

use serde_json::{json, Value};
use tauri::{LogicalPosition, LogicalSize, WebviewWindow};
use uuid::Uuid;

use super::{page, Own};
use crate::{desks::LOCAL, now_ms};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Placed {
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
const FORMER: &str = "app-window.json";
/// How old the file may be: starting again takes seconds, a start much later opens the windows afresh.
const FRESH: Duration = Duration::from_secs(60);
/// A Windows installer can spend several minutes replacing the app before starting it again.
const INSTALL_FRESH: Duration = Duration::from_secs(30 * 60);

impl Placed {
  pub fn of(w: &WebviewWindow, desk: &str, own: &Own, next: &str) -> Option<Placed> {
    let minimized = w.is_minimized().unwrap_or(false);
    let (at, size) = bounds(w, minimized)?;
    Some(Placed {
      desk: desk.to_string(),
      origin: match own {
        Own::Local(_) => None,
        Own::Remote(o) => Some(o.clone()),
      },
      x: at.x,
      y: at.y,
      width: size.width,
      height: size.height,
      maximized: w.is_maximized().unwrap_or(false),
      fullscreen: w.is_fullscreen().unwrap_or(false),
      minimized,
      visible: w.is_visible().unwrap_or(true),
      next: page(w, own).unwrap_or_else(|| next.into()),
      focused: w.is_focused().unwrap_or(false),
      drafts: vec![],
      draft_checkpoint: None,
    })
  }

  fn json(&self) -> Value {
    let mut value = json!({
      "desk": self.desk, "origin": self.origin, "x": self.x, "y": self.y, "width": self.width, "height": self.height,
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

fn bounds(w: &WebviewWindow, minimized: bool) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
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
fn restored_bounds(w: &WebviewWindow) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
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

pub fn keep(home: &Path, windows: &[Placed], installer: bool) -> io::Result<()> {
  let all: Vec<Value> = windows.iter().map(Placed::json).collect();
  let text = json!({ "at": now_ms(), "installer": installer, "windows": all }).to_string();
  let part = home.join(format!("{FILE}.part"));
  let mut options = fs::OpenOptions::new();
  options.write(true).create_new(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  // Discard a partial snapshot from an interrupted write. Publish only after all drafts
  // and placements are on disk, since a successful Windows installer exits this process.
  let _ = fs::remove_file(&part);
  let result = (|| {
    let mut file = options.open(&part)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::rename(&part, home.join(FILE))
  })();
  if result.is_err() {
    let _ = fs::remove_file(part);
  }
  result
}

/// The windows the shell before this one left, this machine's first; none where it left none lately.
pub fn take(home: &Path) -> Vec<Placed> {
  read_saved(home, true)
}

/// No app will relaunch from the staged installer snapshot.
pub fn discard(home: &Path) {
  if let Err(error) = fs::remove_file(home.join(FILE)) {
    if error.kind() != io::ErrorKind::NotFound {
      eprintln!("seismic: cannot remove restart snapshot: {error}");
    }
  }
}

/// The builder needs the initial visibility on macOS before the single-instance check runs.
#[cfg(target_os = "macos")]
pub fn peek(home: &Path) -> Vec<Placed> {
  read_saved(home, false)
}

fn read_saved(home: &Path, consume: bool) -> Vec<Placed> {
  let read = |name: &str| {
    let path = home.join(name);
    let text = fs::read_to_string(&path).ok()?;
    if consume {
      let _ = fs::remove_file(&path);
    }
    serde_json::from_str::<Value>(&text).ok()
  };
  let (now, former) = (read(FILE), read(FORMER));
  let fresh = |v: &Value| {
    let max = if v["installer"] == true { INSTALL_FRESH } else { FRESH };
    v["at"].as_u64().is_some_and(|at| now_ms().saturating_sub(at) <= max.as_millis() as u64)
  };
  let mut windows: Vec<Placed> = match (now.filter(fresh), former.filter(fresh)) {
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
