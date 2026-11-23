// The app's windows: one per workspace (docs/plan/remote-workspaces.md), each with the one origin
// it shows for its life (`Own`): this machine's Seismic (`main`) or a remote one's (`desk-<n>`).
// Besides it a window may show only the pages the shell bundles (desktop/ui: the start page, the
// status page of a workspace that does not answer).
//
// - The navigation guard keeps the window on its origin; what it turns away opens in the system's
//   browser, at most one a second (`Handoff`): the hook is not told whether a frame asked, and a page
//   could otherwise open a tab per frame it embeds. On Windows frames do not reach the hook
//   (WebView2's FrameNavigationStarting, guarded here).
// - Only the window's main frame at its own effective origin reaches the shell: wry's postMessage
//   IPC is gated on macOS (vendor/README.md) and unregistered on Linux, where wry names a call by
//   the page the webview shows, not the frame that sent it; the fetch IPC that stays names its
//   sender by the `Origin` header there.
// - The microphone goes to the window's own origin alone (microphone/).

mod microphone;
pub mod placed;

use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
  time::{Duration, Instant},
};

use tauri::{
  webview::{DownloadEvent, NewWindowResponse, PageLoadEvent},
  AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::{open_in_browser, open_outside, seismic_env, Seismic};
use placed::Placed;

/// The origin a window shows for its life.
#[derive(Clone)]
pub enum Own {
  /// This machine's Seismic, at whichever port it answers on.
  Local(Arc<Seismic>),
  /// A remote workspace's origin (`https://studio.example.ts.net`).
  Remote(String),
}

impl Own {
  pub fn origin(&self) -> Option<String> {
    match self {
      Own::Local(seismic) => seismic.origin(),
      Own::Remote(origin) => Some(origin.clone()),
    }
  }

  /// Whether `url` is at the window's own origin.
  pub fn at(&self, url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && self.origin().is_some_and(|o| o == url.origin().ascii_serialization())
  }

  /// Whether the window may show `url`: its origin's page, or one the shell bundles.
  pub fn admits(&self, url: &Url) -> bool {
    bundled(url) || self.at(url)
  }
}

#[cfg(windows)]
const BUNDLE: &str = "http://tauri.localhost";
#[cfg(not(windows))]
const BUNDLE: &str = "tauri://localhost";

pub fn bundled_url(path: &str) -> Url {
  Url::parse(&format!("{BUNDLE}{path}")).expect("bundled page URL")
}

/// The app's entry points, at the protocol and authority used by this engine.
fn bundled(url: &Url) -> bool {
  let entry = bundled_url("/");
  url.scheme() == entry.scheme()
    && url.host_str() == entry.host_str()
    && url.port().is_none()
    && url.username().is_empty()
    && url.password().is_none()
    && matches!(url.path(), "/" | "/index.html" | "/status.html")
}

/// Where the shell turns a window's navigation away to the system's browser: at most once a second.
#[derive(Default)]
struct Handoff(Mutex<Option<Instant>>);

const HANDOFF_GAP: Duration = Duration::from_secs(1);

impl Handoff {
  fn may(&self, now: Instant) -> bool {
    let mut last = self.0.lock().unwrap();
    if last.is_some_and(|l| now.duration_since(l) < HANDOFF_GAP) {
      return false;
    }
    *last = Some(now);
    true
  }
}

/// A file name in `dir` that is not taken yet: `name`, else `name (2)` and so on.
fn free_name(dir: &Path, name: &str) -> PathBuf {
  let path = dir.join(name);
  if !path.exists() {
    return path;
  }
  let (stem, ext) = name.rsplit_once('.').map_or((name, String::new()), |(s, e)| (s, format!(".{e}")));
  (2..).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap()
}

/// Creates a hidden, inert window on the UI thread. The caller can navigate and show it once the
/// native guards are installed and the window is ready to receive commands.
pub fn build(app: &AppHandle, label: &str, own: Own, placed: Option<&Placed>, handed_over: bool) -> tauri::Result<WebviewWindow> {
  let local = matches!(own, Own::Local(_));
  let (navigation, loaded) = (own.clone(), own.clone());
  let handoff = Handoff::default();
  let seismic = match &own {
    Own::Local(s) => Some(s.clone()),
    Own::Remote(_) => None,
  };
  let downloads = app.path().download_dir().ok();
  let saved: Arc<Mutex<HashMap<String, PathBuf>>> = Default::default();
  let check = seismic_env("APP_CHECK").and_then(|c| c.into_string().ok());
  let blank = Url::parse("about:blank").unwrap();
  let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(blank))
    .visible(false)
    .title("Seismic")
    .inner_size(1440.0, 900.0)
    .min_inner_size(720.0, 480.0)
    .initialization_script(format!(
      "window.seismicApp = {{ version: {:?}, platform: {:?}, built: {}, handedOver: {} }};",
      app.package_info().version.to_string(),
      std::env::consts::OS,
      // installed from a checkout: the commit it was built from, which the settings show
      option_env!("SEISMIC_BUILT_COMMIT")
        .or(option_env!("OBEYA_BUILT_COMMIT"))
        .filter(|c| !c.is_empty())
        .map_or("null".to_string(), |c| format!("{c:?}")),
      handed_over
    ))
    .on_navigation(move |url| {
      if navigation.admits(url) {
        return true;
      }
      if url.as_str() != "about:blank" && handoff.may(Instant::now()) {
        open_in_browser(url.as_str());
      }
      false
    })
    .on_new_window(move |url, _| {
      match &seismic {
        Some(seismic) => open_outside(seismic, &url),
        // a remote page in the browser plainly: that browser pairs on its own
        None => open_in_browser(url.as_str()),
      }
      NewWindowResponse::Deny
    })
    .on_download(move |_, event| {
      match event {
        DownloadEvent::Requested { url, destination } => {
          if let Some(dir) = &downloads {
            let name = destination
              .file_name()
              .map(|n| n.to_string_lossy().into_owned())
              .unwrap_or_else(|| "download".into());
            *destination = free_name(dir, &name);
            saved.lock().unwrap().insert(url.to_string(), destination.clone());
          }
        }
        DownloadEvent::Finished { url, path, success } => {
          let path = path.or_else(|| saved.lock().unwrap().remove(url.as_str()));
          if let (true, Some(path)) = (success, path) {
            let _ = tauri_plugin_opener::reveal_item_in_dir(path);
          }
        }
        _ => {}
      }
      true
    })
    .on_page_load(move |webview, payload| {
      if let (PageLoadEvent::Finished, Some(check)) = (payload.event(), &check) {
        // the window's own pages, and a remote workspace's status page (scripts/check-app-desks.ts)
        if loaded.at(payload.url()) || (!local && bundled(payload.url())) {
          let _ = webview.eval(format!("import({check:?})"));
        }
      }
    });
  // files dropped on this machine's page reach the shell, which hands their paths to it
  // (main.rs, `dragged`); a remote page gets them as a browser would, without this machine's paths
  let builder = if local { builder } else { builder.disable_drag_drop_handler() };
  let builder = match placed {
    Some(p) => builder
      .position(p.x, p.y)
      .inner_size(p.width, p.height)
      .maximized(p.maximized)
      .fullscreen(p.fullscreen),
    None => builder,
  };
  // on a Mac the window has no title bar of its own: the project's bar is it, with the traffic lights in it,
  // centred on the bar's height (50 px, #bar in src/ui/App.tsx). tao makes the title bar the buttons'
  // height plus y and leaves them 9 px above its bottom: the 14 px buttons' centre is y - 2 from the top
  #[cfg(target_os = "macos")]
  let builder = builder
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true)
    .traffic_light_position(tauri::LogicalPosition::new(18.0, 27.0));
  // WebView2 drops WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS when the app sets arguments of its own, as wry
  // does: they go together (scripts/check-app.ts gives it a fake microphone that way)
  #[cfg(windows)]
  let builder = match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
    Ok(extra) => builder.additional_browser_args(&format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection {extra}")),
    Err(_) => builder,
  };
  let window = builder.build()?;
  let installed = (|| {
    let hears = own.clone();
    microphone::install(&window, Arc::new(move |url: &Url| hears.at(url)))?;
    #[cfg(windows)]
    guard_frames(&window, own)?;
    Ok::<_, tauri::Error>(())
  })();
  if let Err(error) = installed {
    let _ = window.destroy();
    return Err(error);
  }
  Ok(window)
}

/// WebView2 asks wry's hook for main-frame navigations alone (NavigationStarting): a frame's goes to
/// FrameNavigationStarting, which the shell cancels unless it stays at the window's origin.
#[cfg(windows)]
fn guard_frames(window: &WebviewWindow, own: Own) -> tauri::Result<()> {
  let (send, receive) = std::sync::mpsc::channel();
  window.with_webview(move |webview| {
    use webview2_com::{take_pwstr, NavigationStartingEventHandler};
    let install = || unsafe {
      let core = webview.controller().CoreWebView2()?;
      core.add_FrameNavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_, args| {
          let Some(args) = args else { return Ok(()) };
          let mut uri = windows_core::PWSTR::null();
          args.Uri(&mut uri)?;
          let uri = take_pwstr(uri);
          let allowed = uri == "about:blank" || uri == "about:srcdoc" || Url::parse(&uri).is_ok_and(|u| own.at(&u));
          args.SetCancel(!allowed)?;
          Ok(())
        })),
        &mut 0,
      )
    };
    let _ = send.send(install());
  })?;
  receive
    .try_recv()
    .map_err(std::io::Error::other)?
    .map_err(|e| std::io::Error::other(e.to_string()).into())
}

/// The window's page, where it is at the window's own origin: its path, query and fragment.
pub fn page(w: &WebviewWindow, own: &Own) -> Option<String> {
  w.url().ok().filter(|u| own.at(u)).map(|u| crate::next_of(&u))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::Ordering;

  #[test]
  fn a_window_admits_its_origin_and_the_bundled_pages_alone() {
    let own = Own::Remote("https://studio".into());
    let admits = |u: &str| own.admits(&Url::parse(u).unwrap());
    assert!(admits("https://studio/p/1?x#y"));
    assert!(admits(bundled_url("/status.html").as_str()));
    assert!(admits(bundled_url("/index.html?updating").as_str()));
    assert!(!admits(bundled_url("/other.html").as_str()));
    assert_eq!(admits("tauri://localhost/status.html"), !cfg!(windows));
    assert_eq!(admits("http://tauri.localhost/status.html"), cfg!(windows));
    assert!(!admits("http://tauri.localhost:8000/status.html"));
    assert!(!admits("https://tauri.localhost/status.html"));
    assert!(!admits("tauri://other/status.html"));
    assert!(!admits("http://studio/"));
    assert!(!admits("https://studio:8443/"));
    assert!(!admits("https://studio.evil/"));
    assert!(!admits("about:blank"));
    assert!(!admits("data:text/html,hi"));
  }

  #[test]
  fn this_machines_window_admits_its_port_alone() {
    let seismic = Arc::new(Seismic::default());
    let own = Own::Local(seismic.clone());
    assert!(!own.at(&Url::parse("http://127.0.0.1:4417/").unwrap()));
    seismic.port.store(4417, Ordering::SeqCst);
    assert!(own.at(&Url::parse("http://127.0.0.1:4417/p").unwrap()));
    assert!(!own.at(&Url::parse("http://127.0.0.1:4418/").unwrap()));
    assert!(!own.at(&Url::parse("http://localhost:4417/").unwrap()));
  }

  #[test]
  fn a_window_hands_off_at_most_one_navigation_a_second() {
    let handoff = Handoff::default();
    let start = Instant::now();
    assert!(handoff.may(start));
    assert!(!handoff.may(start + Duration::from_millis(500)));
    assert!(handoff.may(start + Duration::from_millis(1100)));
  }
}
