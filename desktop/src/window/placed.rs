// The windows as the shell left them to start again (main.rs, `relaunch`), for the new one to open
// them the same: which workspace each showed, where it stood and how large, the page at its origin.
// A file in the home, taken once and only fresh. A shell from before the workspaces wrote its one
// window to `app-window.json`, which counts as this machine's.

use std::{fs, path::Path, time::Duration};

use serde_json::{json, Value};
use tauri::WebviewWindow;

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
  /// Shown: closed on a Mac, this machine's window is hidden while the app stays in the Dock.
  pub visible: bool,
  /// The page it showed at its origin.
  pub next: String,
  /// The window the owner was in.
  pub focused: bool,
}

const FILE: &str = "app-windows.json";
const FORMER: &str = "app-window.json";
/// How old the file may be: starting again takes seconds, a start much later opens the windows afresh.
const FRESH: Duration = Duration::from_secs(60);

impl Placed {
  pub fn of(w: &WebviewWindow, desk: &str, own: &Own) -> Option<Placed> {
    let scale = w.scale_factor().ok()?;
    let at = w.outer_position().ok()?.to_logical::<f64>(scale);
    let size = w.inner_size().ok()?.to_logical::<f64>(scale);
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
      visible: w.is_visible().unwrap_or(true),
      next: page(w, own).unwrap_or_else(|| "/".into()),
      focused: w.is_focused().unwrap_or(false),
    })
  }

  fn json(&self) -> Value {
    json!({
      "desk": self.desk, "origin": self.origin, "x": self.x, "y": self.y, "width": self.width, "height": self.height,
      "maximized": self.maximized, "fullscreen": self.fullscreen, "visible": self.visible, "next": self.next, "focused": self.focused,
    })
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
      visible: v["visible"].as_bool().unwrap_or(true),
      next: v["next"].as_str().filter(|n| n.starts_with('/')).unwrap_or("/").to_string(),
      focused: b("focused"),
    })
  }
}

pub fn keep(home: &Path, windows: &[Placed]) {
  let all: Vec<Value> = windows.iter().map(Placed::json).collect();
  let _ = fs::write(home.join(FILE), json!({ "at": now_ms(), "windows": all }).to_string());
}

/// The windows the shell before this one left, this machine's first; none where it left none lately.
pub fn take(home: &Path) -> Vec<Placed> {
  let read = |name: &str| {
    let path = home.join(name);
    let text = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    serde_json::from_str::<Value>(&text).ok()
  };
  let (now, former) = (read(FILE), read(FORMER));
  let fresh = |v: &Value| v["at"].as_u64().is_some_and(|at| now_ms().saturating_sub(at) <= FRESH.as_millis() as u64);
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
      visible: false,
      next: "/".into(),
      ..Default::default()
    };
    keep(&home, &[remote.clone(), local.clone()]);
    assert_eq!(take(&home), vec![local, remote]);
    assert_eq!(take(&home), vec![]);
    let _ = fs::remove_dir_all(&home);
  }

  #[test]
  fn a_former_shells_window_is_this_machines() {
    let home = home("former");
    let former = json!({ "at": now_ms(), "x": 1.0, "y": 2.0, "width": 800.0, "height": 600.0, "maximized": true, "visible": true, "next": "/x" });
    fs::write(home.join(FORMER), former.to_string()).unwrap();
    let taken = take(&home);
    assert_eq!(taken.len(), 1);
    assert_eq!((taken[0].desk.as_str(), taken[0].next.as_str(), taken[0].maximized), (LOCAL, "/x", true));
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
