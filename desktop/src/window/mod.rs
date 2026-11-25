// One native window hosts the current workspace. Each attached webview has a fixed origin.
//
// - The navigation guard keeps the window on its origin. Rejected navigations and remote popups
//   share one browser handoff per second: a page could otherwise open a tab per frame it embeds.
//   Windows frame navigation has a separate guard through WebView2's FrameNavigationStarting.
// - Only the window's main frame at its own effective origin reaches the shell: wry's postMessage
//   IPC is gated on macOS (vendor/README.md) and unregistered on Linux, where wry names a call by
//   the page the webview shows, not the frame that sent it; the fetch IPC that stays names its
//   sender by the `Origin` header there. As Tauri's script falls back to postMessage for the rest
//   of a document once one fetch failed, on Linux a failed fetch fails that call alone
//   (linux_ipc.js).
// - The microphone goes to the window's own origin alone (microphone/).

pub mod drafts;
mod microphone;
pub mod placed;

#[tauri::command]
pub async fn workspace_start_dragging(webview: Webview) -> tauri::Result<()> {
  if !crate::desks::shell(webview.app_handle()).is_current(webview.label()) {
    return Ok(());
  }
  webview.window().start_dragging()
}

#[tauri::command]
pub async fn workspace_toggle_maximize(webview: Webview) -> tauri::Result<()> {
  if !crate::desks::shell(webview.app_handle()).is_current(webview.label()) {
    return Ok(());
  }
  let window = webview.window();
  if window.is_resizable()? {
    if window.is_maximized()? {
      window.unmaximize()?;
    } else if window.is_maximizable()? {
      window.maximize()?;
    }
  }
  Ok(())
}

use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
  time::{Duration, Instant},
};

use tauri::{
  webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder},
  window::WindowBuilder,
  AppHandle, Manager, PhysicalPosition, Url, Webview, WebviewEvent, WebviewUrl, Window,
};

use crate::{open_in_browser, open_outside, seismic_env};
use placed::Placed;

/// The origin a webview shows for its life.
#[derive(Clone, PartialEq, Eq)]
pub enum Own {
  /// This machine's server at a fixed port. The startup window has no server origin.
  Local(Option<u16>),
  /// A remote workspace's origin (`https://studio.example.ts.net`).
  Remote(String),
}

impl Own {
  pub fn origin(&self) -> Option<String> {
    match self {
      Own::Local(port) => port.map(crate::local_origin),
      Own::Remote(origin) => Some(origin.clone()),
    }
  }

  /// Whether `url` is at the window's own origin.
  pub fn at(&self, url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && self.origin().is_some_and(|o| o == url.origin().ascii_serialization())
  }

  /// Whether the window may show `url`: its origin's page, or one the shell bundles.
  pub fn admits(&self, url: &Url) -> bool {
    self.admits_at(BUNDLE, url)
  }

  fn admits_at(&self, bundle: &str, url: &Url) -> bool {
    self.at(url) || bundled_at(bundle, url) && match self {
      Own::Local(_) => matches!(url.path(), "/" | "/index.html"),
      Own::Remote(_) => *url == bundled_url_at(bundle, "/status.html"),
    }
  }
}

#[cfg_attr(windows, allow(dead_code))]
const BUNDLE_UNIX: &str = "tauri://localhost";
#[cfg_attr(not(windows), allow(dead_code))]
const BUNDLE_WINDOWS: &str = "http://tauri.localhost";

#[cfg(windows)]
const BUNDLE: &str = BUNDLE_WINDOWS;
#[cfg(not(windows))]
const BUNDLE: &str = BUNDLE_UNIX;

pub fn bundled_url(path: &str) -> Url {
  bundled_url_at(BUNDLE, path)
}

fn bundled_url_at(bundle: &str, path: &str) -> Url {
  Url::parse(&format!("{bundle}{path}")).expect("bundled page URL")
}

/// Open a workspace page in the browser. The bundled status screen stands in for its origin.
pub fn browser_target(page: Url, own: &Own) -> Option<Url> {
  browser_target_at(BUNDLE, page, own)
}

fn browser_target_at(bundle: &str, page: Url, own: &Own) -> Option<Url> {
  if own.at(&page) {
    return Some(page);
  }
  if let Own::Remote(origin) = own {
    if page == bundled_url_at(bundle, "/status.html") {
      return Url::parse(origin).ok();
    }
  }
  None
}

/// The app's entry points, at the protocol and authority used by this engine.
fn bundled(url: &Url) -> bool {
  bundled_at(BUNDLE, url)
}

fn bundled_at(bundle: &str, url: &Url) -> bool {
  bundled_origin_at(bundle, url) && matches!(url.path(), "/" | "/index.html" | "/status.html")
}

fn bundled_origin_at(bundle: &str, url: &Url) -> bool {
  let entry = bundled_url_at(bundle, "/");
  url.scheme() == entry.scheme()
    && url.host_str() == entry.host_str()
    && url.port() == entry.port()
    && url.username() == entry.username()
    && url.password() == entry.password()
}

pub(crate) fn browser_handoff_url(url: &Url) -> bool {
  browser_handoff_url_at(BUNDLE, url)
}

fn browser_handoff_url_at(bundle: &str, url: &Url) -> bool {
  matches!(url.scheme(), "http" | "https" | "mailto") && !bundled_origin_at(bundle, url)
}

/// Where the shell turns a window's requests away to the system's browser: at most once a second.
#[derive(Default)]
struct Handoff(Mutex<Option<Instant>>);

const HANDOFF_GAP: Duration = Duration::from_secs(1);

impl Handoff {
  fn may(&self, url: &Url, now: Instant) -> bool {
    self.may_at(BUNDLE, url, now)
  }

  fn may_at(&self, bundle: &str, url: &Url, now: Instant) -> bool {
    if !browser_handoff_url_at(bundle, url) {
      return false;
    }
    let mut last = self.0.lock().unwrap();
    if last.is_some_and(|l| now.duration_since(l) < HANDOFF_GAP) {
      return false;
    }
    *last = Some(now);
    true
  }
}

#[derive(Debug, PartialEq, Eq)]
enum Navigation {
  Allow,
  OpenInBrowser,
  Block,
}

fn decide_navigation_with(admitted: bool, handoff: &Handoff, bundle: &str, url: &Url, now: Instant) -> Navigation {
  if admitted {
    return Navigation::Allow;
  }
  if handoff.may_at(bundle, url, now) {
    Navigation::OpenInBrowser
  } else {
    Navigation::Block
  }
}

fn decide_navigation(own: &Own, handoff: &Handoff, url: &Url, now: Instant) -> Navigation {
  decide_navigation_with(own.admits(url), handoff, BUNDLE, url, now)
}

#[cfg(test)]
fn decide_navigation_at(own: &Own, handoff: &Handoff, bundle: &str, url: &Url, now: Instant) -> Navigation {
  decide_navigation_with(own.admits_at(bundle, url), handoff, bundle, url, now)
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

/// Shows a restored window on the UI thread without activating a background window.
pub fn show_placed(w: &Window, placed: Option<&Placed>, focus: bool) -> tauri::Result<()> {
  let minimized = placed.is_some_and(|p| p.minimized);
  let focus = focus && !minimized;
  let fullscreen = placed.is_some_and(|p| p.fullscreen);
  if fullscreen && !focus {
    // Entering fullscreen on a background window can activate it or switch Spaces.
    let app = w.app_handle().clone();
    let label = w.label().to_string();
    let pending = std::sync::atomic::AtomicBool::new(true);
    w.on_window_event(move |event| {
      if matches!(event, tauri::WindowEvent::Focused(true)) && pending.swap(false, std::sync::atomic::Ordering::Relaxed) {
        if let Some(window) = app.get_window(&label) {
          let _ = window.set_fullscreen(true);
        }
      }
    });
  }
  if minimized {
    // The window must be available from the Dock or taskbar even if it was reported hidden.
    return show_minimized(w);
  }
  if placed.is_some_and(|p| !p.visible) {
    return Ok(());
  }
  if placed.is_none() || focus {
    w.show()?;
    let _ = w.set_focus();
  } else {
    show_background(w)?;
  }
  if fullscreen && focus {
    let _ = w.set_fullscreen(true);
  }
  Ok(())
}

#[cfg(not(windows))]
fn show_minimized(w: &Window) -> tauri::Result<()> {
  show_background(w)?;
  w.minimize()
}

#[cfg(windows)]
fn show_minimized(w: &Window) -> tauri::Result<()> {
  use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, SetWindowPlacement, WINDOWPLACEMENT, SW_SHOWMINNOACTIVE};
  let hwnd = w.hwnd()?.0;
  let mut placement = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
  if unsafe { GetWindowPlacement(hwnd, &mut placement) } == 0 {
    return Err(std::io::Error::last_os_error().into());
  }
  placement.showCmd = SW_SHOWMINNOACTIVE as u32;
  if unsafe { SetWindowPlacement(hwnd, &placement) } == 0 {
    return Err(std::io::Error::last_os_error().into());
  }
  Ok(())
}

#[cfg(target_os = "macos")]
fn show_background(w: &Window) -> tauri::Result<()> {
  // Tao's show makes the window key. Keep it behind the app the owner is using.
  unsafe {
    let window = &*w.ns_window()?.cast::<objc2::runtime::AnyObject>();
    let _: () = objc2::msg_send![window, orderBack: std::ptr::null::<objc2::runtime::AnyObject>()];
  }
  Ok(())
}

#[cfg(windows)]
fn show_background(w: &Window) -> tauri::Result<()> {
  use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW};
  let flags = SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW;
  if unsafe { SetWindowPos(w.hwnd()?.0, HWND_BOTTOM, 0, 0, 0, 0, flags) } == 0 {
    return Err(std::io::Error::last_os_error().into());
  }
  Ok(())
}

#[cfg(target_os = "linux")]
fn show_background(w: &Window) -> tauri::Result<()> {
  use gtk::prelude::GtkWindowExt;
  w.gtk_window()?.set_focus_on_map(false);
  w.show()
}

/// Builds the single native window. Workspace changes leave this window in place.
pub fn create(app: &AppHandle, placed: Option<&Placed>) -> tauri::Result<Window> {
  let mut config = tauri::utils::config::WindowConfig {
    label: crate::desks::WINDOW.into(), title: "Seismic".into(), visible: false,
    width: 1440.0, height: 900.0, min_width: Some(720.0), min_height: Some(480.0),
    ..Default::default()
  };
  #[cfg(target_os = "macos")]
  {
    config.title_bar_style = tauri::TitleBarStyle::Overlay;
    config.hidden_title = true;
    config.traffic_light_position = Some(tauri::utils::config::LogicalPosition { x: 18.0, y: 27.0 });
  }
  if let Some(p) = placed {
    config.focus = false;
    config.x = Some(p.x);
    config.y = Some(p.y);
    config.width = p.width;
    config.height = p.height;
    config.maximized = p.maximized;
  }
  WindowBuilder::from_config(app, &config)?.build()
}

/// Attach a blank webview, with native guards installed before the first page loads.
pub fn build(app: &AppHandle, label: &str, own: Own, placed: Option<&Placed>, handed_over: bool) -> tauri::Result<Webview> {
  let local = matches!(own, Own::Local(_));
  let (navigation, loaded) = (own.clone(), own.clone());
  let handoff = Arc::new(Handoff::default());
  let popup_handoff = handoff.clone();
  let popup = own.clone();
  let downloads = app.path().download_dir().ok();
  let saved: Arc<Mutex<HashMap<String, PathBuf>>> = Default::default();
  let check = seismic_env("APP_CHECK").and_then(|c| c.into_string().ok());
  // The restart check observes the canvas before the webview has finished its startup requests.
  let early_check = cfg!(debug_assertions) && seismic_env("APP_CHECK_LEASE").is_some();
  let check_script = if early_check {
    check.as_ref().zip(own.origin()).map(|(check, origin)| format!(
      "if (window === window.top && location.origin === {origin:?}) import({check:?});"
    ))
  } else {
    None
  };
  #[cfg(debug_assertions)]
  if check.is_some() {
    // The native check trusts an empty handoff log only when this debug recorder is present.
    let _ = std::fs::write(crate::home().join("check-browser-handoffs-active"), "");
  }
  let check_bundled = seismic_env("APP_CHECK_BUNDLED").is_some();
  let blank = Url::parse("about:blank").unwrap();
  #[cfg(target_os = "linux")]
  let message_key = uuid::Uuid::new_v4().to_string();
  #[cfg(not(target_os = "linux"))]
  let message_key = app.invoke_key();
  let draft_script = own.origin().map(|origin| drafts::script(&origin, placed, message_key.as_ref()));
  let restoring_drafts = draft_script.is_some() && placed.is_some_and(|p| p.draft_checkpoint.is_some() || !p.drafts.is_empty());
  let builder = WebviewBuilder::new(label, WebviewUrl::External(blank))
    .focused(false)
    .auto_resize()
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
    .initialization_script(include_str!("controls.js"))
    .initialization_script(if cfg!(target_os = "linux") { include_str!("linux_ipc.js") } else { "" })
    .on_navigation(move |url| match decide_navigation(&navigation, &handoff, url, Instant::now()) {
      Navigation::Allow => true,
      Navigation::OpenInBrowser => {
        open_in_browser(url.as_str());
        false
      }
      Navigation::Block => false,
    })
    .on_new_window(move |url, _| {
      match &popup {
        Own::Local(port) => open_outside(*port, &url),
        // a remote page in the browser plainly: that browser pairs on its own
        Own::Remote(_) if popup_handoff.may(&url, Instant::now()) => open_in_browser(url.as_str()),
        Own::Remote(_) => {}
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
      if let PageLoadEvent::Finished = payload.event() {
        let own_page = loaded.at(payload.url());
        if own_page {
          crate::desks::page_loaded(webview.app_handle(), webview.label(), payload.url());
        }
        if restoring_drafts && own_page {
          let app = webview.app_handle().clone();
          let label = webview.label().to_string();
          let origin = serde_json::json!(loaded.origin());
          let confirms = format!("location.origin === {origin} && window.seismicDraftsReceived === true");
          let _ = webview.eval_with_callback(confirms, move |restored| {
            if restored == "true" {
              crate::desks::drafts_restored(&app, &label);
            }
          });
        }
        // The check runs in the workspace and in the bundled status page (plus startup/updating when asked).
        if let Some(check) = check.as_ref().filter(|_| !early_check && (own_page || ((!local || check_bundled) && bundled(payload.url())))) {
          let minimized = webview.window().is_minimized().unwrap_or(false);
          let windows = webview.app_handle().windows().len();
          let _ = webview.eval(format!("window.seismicCheckMinimized = {minimized}; window.seismicCheckWindowCount = {windows}; import({check:?})"));
        }
      }
    });
  let builder = match draft_script {
    Some(script) => builder.initialization_script(script),
    None => builder,
  };
  let builder = match check_script {
    Some(script) => builder.initialization_script(script),
    None => builder,
  };
  // files dropped on this machine's page reach the shell, which hands their paths to it
  // (main.rs, `dragged`); a remote page gets them as a browser would, without this machine's paths
  let builder = if local { builder } else { builder.disable_drag_drop_handler() };
  // WebView2 drops WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS when the app sets arguments of its own, as wry
  // does: they go together (scripts/check-app.ts gives it a fake microphone that way)
  #[cfg(windows)]
  let builder = match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
    Ok(extra) => builder.additional_browser_args(&format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection {extra}")),
    Err(_) => builder,
  };
  let window = app.get_window(crate::desks::WINDOW).ok_or(tauri::Error::WindowNotFound)?;
  let webview = window.add_child(builder, PhysicalPosition::new(0, 0), window.inner_size()?)?;
  if local {
    let app = app.clone();
    let label = label.to_string();
    webview.on_webview_event(move |event| {
      if let WebviewEvent::DragDrop(drag) = event {
        if let Some(w) = crate::desks::local_view(&app).filter(|w| w.label() == label) {
          crate::dragged(&w, drag);
        }
      }
    });
  }
  let installed = (|| {
    let hears = own.clone();
    microphone::install(&webview, Arc::new(move |url: &Url| hears.at(url)))?;
    #[cfg(target_os = "linux")]
    if own.origin().is_some() {
      drafts::install(&webview, message_key)?;
    }
    #[cfg(windows)]
    guard_frames(&webview, own)?;
    Ok::<_, tauri::Error>(())
  })();
  if let Err(error) = installed {
    let _ = close(&webview);
    return Err(error);
  }
  Ok(webview)
}

pub fn close(webview: &Webview) -> tauri::Result<()> {
  #[cfg(target_os = "macos")]
  microphone::uninstall(webview);
  webview.close()
}

#[cfg(any(windows, test))]
fn frame_allowed(own: &Own, uri: &str) -> bool {
  uri == "about:blank" || uri == "about:srcdoc" || Url::parse(uri).is_ok_and(|u| own.at(&u))
}

/// WebView2 asks wry's hook for main-frame navigations alone (NavigationStarting): a frame's goes to
/// FrameNavigationStarting, which the shell cancels unless it stays at the window's origin.
#[cfg(windows)]
fn guard_frames(webview: &Webview, own: Own) -> tauri::Result<()> {
  let (send, receive) = std::sync::mpsc::channel();
  webview.with_webview(move |webview| {
    use webview2_com::{take_pwstr, NavigationStartingEventHandler};
    let install = || unsafe {
      let core = webview.controller().CoreWebView2()?;
      core.add_FrameNavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_, args| {
          let Some(args) = args else { return Ok(()) };
          let mut uri = windows_core::PWSTR::null();
          args.Uri(&mut uri)?;
          let uri = take_pwstr(uri);
          let allowed = frame_allowed(&own, &uri);
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

/// Verify the displayed navigation, including HTTP failures rendered at the workspace origin.
pub fn shows_workspace(webview: &Webview, origin: &str, timeout: Duration) -> bool {
  let (send, receive) = std::sync::mpsc::channel();
  // The navigation entry describes this response, including redirects and the device cookie.
  // Older engines omit responseStatus. Recognize the workspace and its signed-out pairing form.
  let script = format!(r#"(() => {{
    if (location.origin !== {}) return false;
    const status = performance.getEntriesByType('navigation')[0]?.responseStatus || 0;
    if ((!status || status === 401) && document.querySelector('form[action="/pair"] input[name="code"]')) return true;
    return status ? status >= 200 && status < 300 :
      !!(document.getElementById('root') && document.querySelector('link[rel="manifest"]'));
  }})()"#, serde_json::json!(origin));
  if webview.eval_with_callback(script, move |value| { let _ = send.send(value); }).is_err() {
    return false;
  }
  receive.recv_timeout(timeout).is_ok_and(|value| value == "true")
}

/// The window's page, where it is at the window's own origin: its path, query and fragment.
pub fn page(w: &Webview, own: &Own) -> Option<String> {
  w.url().ok().filter(|u| own.at(u)).map(|u| crate::next_of(&u))
}

#[cfg(test)]
mod tests {
  use super::*;

  const BUNDLES: [(&str, &str); 2] = [(BUNDLE_UNIX, BUNDLE_WINDOWS), (BUNDLE_WINDOWS, BUNDLE_UNIX)];

  #[test]
  fn a_window_admits_its_origin_and_the_bundled_pages_alone() {
    let own = Own::Remote("https://studio".into());
    for (bundle, other) in BUNDLES {
      let url = |path: &str| bundled_url_at(bundle, path);
      let nav = |u: &str| decide_navigation_at(&own, &Handoff::default(), bundle, &Url::parse(u).unwrap(), Instant::now());
      assert_eq!(nav("https://studio/p/1?x#y"), Navigation::Allow);
      assert_eq!(nav(url("/status.html").as_str()), Navigation::Allow);
      // exact status URL alone: query, fragment, startup, updater, and other bundled paths are rejected
      assert_eq!(nav(url("/status.html?x").as_str()), Navigation::Block);
      assert_eq!(nav(url("/status.html#y").as_str()), Navigation::Block);
      assert_eq!(nav(url("/status.html?x#y").as_str()), Navigation::Block);
      assert_eq!(nav(url("/").as_str()), Navigation::Block);
      assert_eq!(nav(url("/index.html").as_str()), Navigation::Block);
      assert_eq!(nav(url("/index.html?updating").as_str()), Navigation::Block);
      assert_eq!(nav(url("/other.html").as_str()), Navigation::Block);
      assert_eq!(nav(&format!("{other}/status.html")), if other == BUNDLE_WINDOWS { Navigation::OpenInBrowser } else { Navigation::Block });
      assert_eq!(nav("http://tauri.localhost:8000/status.html"), Navigation::OpenInBrowser);
      assert_eq!(nav("https://tauri.localhost/status.html"), Navigation::OpenInBrowser);
      assert_eq!(nav("tauri://other/status.html"), Navigation::Block);
      assert_eq!(nav("http://studio/"), Navigation::OpenInBrowser);
      assert_eq!(nav("https://studio:8443/"), Navigation::OpenInBrowser);
      assert_eq!(nav("https://studio.evil/"), Navigation::OpenInBrowser);
      assert_eq!(nav("about:blank"), Navigation::Block);
      assert_eq!(nav("data:text/html,hi"), Navigation::Block);
    }
    // active platform wrapper matches the platform's bundled origin
    assert_eq!(own.admits(&Url::parse("tauri://localhost/status.html").unwrap()), !cfg!(windows));
    assert_eq!(own.admits(&Url::parse("http://tauri.localhost/status.html").unwrap()), cfg!(windows));
    assert!(!own.admits(&bundled_url("/status.html?x")));
    assert!(!own.admits(&bundled_url("/status.html#y")));
  }

  #[test]
  fn this_machines_window_admits_the_startup_and_updater_screens_alone() {
    for (bundle, other) in BUNDLES {
      let url = |path: &str| bundled_url_at(bundle, path);
      for own in [Own::Local(None), Own::Local(Some(4417))] {
        let nav = |u: &str| decide_navigation_at(&own, &Handoff::default(), bundle, &Url::parse(u).unwrap(), Instant::now());
        assert_eq!(nav(url("/").as_str()), Navigation::Allow);
        assert_eq!(nav(url("/index.html").as_str()), Navigation::Allow);
        assert_eq!(nav(url("/index.html?updating").as_str()), Navigation::Allow);
        assert_eq!(nav(url("/status.html").as_str()), Navigation::Block);
        assert_eq!(nav(url("/status.html?x").as_str()), Navigation::Block);
        assert_eq!(nav(url("/status.html#y").as_str()), Navigation::Block);
        assert_eq!(nav(url("/other.html").as_str()), Navigation::Block);
        assert_eq!(nav(&format!("{other}/index.html?updating")), if other == BUNDLE_WINDOWS { Navigation::OpenInBrowser } else { Navigation::Block });
        assert_eq!(nav("https://tauri.localhost/"), Navigation::OpenInBrowser);
        assert_eq!(nav("https://example.com/"), Navigation::OpenInBrowser);
      }
      assert_eq!(
        decide_navigation_at(&Own::Local(None), &Handoff::default(), bundle, &Url::parse("http://127.0.0.1:4417/").unwrap(), Instant::now()),
        Navigation::OpenInBrowser,
      );
      assert_eq!(
        decide_navigation_at(&Own::Local(Some(4417)), &Handoff::default(), bundle, &Url::parse("http://127.0.0.1:4417/").unwrap(), Instant::now()),
        Navigation::Allow,
      );
    }
    let local = Own::Local(None);
    assert_eq!(local.admits(&Url::parse("tauri://localhost/index.html?updating").unwrap()), !cfg!(windows));
    assert_eq!(local.admits(&Url::parse("http://tauri.localhost/index.html?updating").unwrap()), cfg!(windows));
  }

  #[test]
  fn subframes_never_load_bundled_screens() {
    for own in [Own::Local(None), Own::Local(Some(4417)), Own::Remote("https://studio".into())] {
      assert!(frame_allowed(&own, "about:blank"));
      assert!(frame_allowed(&own, "about:srcdoc"));
      assert!(!frame_allowed(&own, "tauri://localhost/"));
      assert!(!frame_allowed(&own, "tauri://localhost/status.html"));
      assert!(!frame_allowed(&own, "http://tauri.localhost/"));
      assert!(!frame_allowed(&own, "http://tauri.localhost/index.html?updating"));
      assert!(!frame_allowed(&own, "http://tauri.localhost/status.html"));
    }
    assert!(frame_allowed(&Own::Local(Some(4417)), "http://127.0.0.1:4417/p"));
    assert!(frame_allowed(&Own::Remote("https://studio".into()), "https://studio/p"));
  }

  #[test]
  fn this_machines_window_admits_its_port_alone() {
    let origin = |port| Url::parse(&format!("http://127.0.0.1:{port}/p")).unwrap();
    assert!(!Own::Local(None).at(&origin(4417)));
    let old = Own::Local(Some(4417));
    let replacement = Own::Local(Some(4418));
    assert!(old.at(&origin(4417)));
    assert!(!old.at(&origin(4418)));
    assert!(replacement.at(&origin(4418)));
    assert!(!replacement.at(&origin(4417)));
    assert!(!replacement.at(&Url::parse("http://localhost:4418/").unwrap()));
  }

  #[test]
  fn the_browser_opens_a_workspace_page_or_its_origin_from_status() {
    let remote = Own::Remote("https://[fd7a::2]:4417".into());
    let project = Url::parse("https://[fd7a::2]:4417/projects/lab?view=table#card").unwrap();
    for (bundle, _) in BUNDLES {
      assert_eq!(browser_target_at(bundle, project.clone(), &remote), Some(project.clone()));
      assert_eq!(browser_target_at(bundle, bundled_url_at(bundle, "/status.html"), &remote).unwrap().as_str(), "https://[fd7a::2]:4417/");
      assert!(browser_target_at(bundle, bundled_url_at(bundle, "/status.html?x"), &remote).is_none());
      assert!(browser_target_at(bundle, bundled_url_at(bundle, "/status.html#y"), &remote).is_none());
      assert!(browser_target_at(bundle, bundled_url_at(bundle, "/index.html?updating"), &remote).is_none());
      let local = Own::Local(Some(4417));
      let local_page = Url::parse("http://127.0.0.1:4417/lab").unwrap();
      assert_eq!(browser_target_at(bundle, local_page.clone(), &local), Some(local_page));
      assert!(browser_target_at(bundle, bundled_url_at(bundle, "/status.html"), &local).is_none());
    }
    assert_eq!(browser_target(bundled_url("/status.html"), &remote).unwrap().as_str(), "https://[fd7a::2]:4417/");
  }

  #[test]
  fn navigation_and_popup_share_the_windows_browser_limit() {
    let navigation = Arc::new(Handoff::default());
    let popup = navigation.clone();
    let url = Url::parse("https://example.com").unwrap();
    let blank = Url::parse("about:blank").unwrap();
    let bundled_win = Url::parse("http://tauri.localhost/index.html?updating").unwrap();
    let start = Instant::now();
    assert!(!popup.may(&blank, start));
    assert!(!navigation.may_at(BUNDLE_WINDOWS, &bundled_win, start));
    assert!(navigation.may(&url, start));
    assert!(!popup.may(&url, start + Duration::from_millis(500)));
    assert!(popup.may(&url, start + HANDOFF_GAP));
    assert!(!navigation.may(&url, start + HANDOFF_GAP));
    assert!(Handoff::default().may(&url, start));
  }

  #[test]
  fn browser_handoffs_exclude_only_the_actual_bundled_origin() {
    for (bundle, other) in BUNDLES {
      assert!(!browser_handoff_url_at(bundle, &bundled_url_at(bundle, "/status.html")));
      assert!(browser_handoff_url_at(bundle, &bundled_url_at(other, "/status.html")) == (other == BUNDLE_WINDOWS));
      assert!(browser_handoff_url_at(bundle, &Url::parse("http://tauri.localhost:8000/").unwrap()));
      assert!(browser_handoff_url_at(bundle, &Url::parse("https://tauri.localhost/").unwrap()));
    }
    assert!(!browser_handoff_url(&bundled_url("/index.html?updating")));
  }
}
