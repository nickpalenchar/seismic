// The microphone goes to the window's own origin alone, a listed one (`hears`), never to a frame of
// another origin or to a page the window shows on its way elsewhere; the camera to none. The
// webview's own permission callback (Tauri's `on_permission_request`) is not told who asks, so each
// engine's own is used: WKWebView names the requesting frame, WebView2 its origin, and WebKitGTK only
// the page committed in the window, whose frames of other origins are kept out instead.
// The page records only while Space or the mic button is held; the system asks once for the app.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

use std::sync::Arc;

use tauri::{Url, WebviewWindow};

/// Whether a page at that URL may have the microphone.
pub type Hears = Arc<dyn Fn(&Url) -> bool + Send + Sync>;

pub fn install(window: &WebviewWindow, hears: Hears) -> tauri::Result<()> {
  #[cfg(target_os = "macos")]
  macos::install(window, hears)?;
  #[cfg(windows)]
  windows::install(window, hears)?;
  #[cfg(target_os = "linux")]
  window.with_webview(move |webview| linux::install(webview, hears))?;
  #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
  let _ = (window, hears);
  Ok(())
}
