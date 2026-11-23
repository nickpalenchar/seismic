// WKWebView names the requesting frame even when an iframe asks. The media decision of each window's
// wry UI delegate is overridden (a subclass of its class, registered once and given to each
// delegate), wry's implementation of its other callbacks kept.
use std::{
  cell::RefCell,
  collections::HashMap,
  io,
  sync::{mpsc, OnceLock},
};

use block2::Block;
use objc2::{
  msg_send,
  rc::Retained,
  runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
  sel,
};
use objc2_web_kit::{WKFrameInfo, WKMediaCaptureType, WKPermissionDecision, WKSecurityOrigin, WKWebView};
use tauri::{webview::PlatformWebview, Url, WebviewWindow};

use super::Hears;

thread_local! {
  /// Each window's WKWebView, by its address, with whom it lets have the microphone.
  static WINDOWS: RefCell<HashMap<usize, Hears>> = RefCell::new(HashMap::new());
}

/// The subclass's address: the class is registered once and lives for the program's life.
static CLASS: OnceLock<usize> = OnceLock::new();

pub fn install(window: &WebviewWindow, hears: Hears) -> tauri::Result<()> {
  let (send, receive) = mpsc::channel();
  window.with_webview(move |webview| {
    let _ = send.send(configure(webview, hears));
  })?;
  receive.try_recv().map_err(io::Error::other)?
}

fn configure(webview: PlatformWebview, hears: Hears) -> tauri::Result<()> {
  // SAFETY: Tauri calls this with a live WKWebView on the main thread. The subclass adds no
  // ivars and wry continues to own and retain the original delegate instance.
  unsafe {
    let view = &*webview.inner().cast::<WKWebView>();
    let checking = crate::seismic_env("APP_CHECK").is_some();
    if checking {
      visible_unattended(view);
      if crate::seismic_env("APP_CHECK_FAKE_MIC").is_some() {
        mock_capture_devices(view);
      }
    }
    let check_legacy = cfg!(debug_assertions) && checking && crate::seismic_env("APP_CHECK_LEGACY_MIC").is_some();
    if !objc2::available!(macos = 12.0) || check_legacy {
      // Big Sur's legacy delegate only gets URLs, which can't prove an iframe's effective
      // origin. Disable WebKit's media devices preference before the first workspace page.
      let configuration: Retained<AnyObject> = msg_send![view, configuration];
      let preferences: Retained<AnyObject> = msg_send![&*configuration, preferences];
      let setter: Bool = msg_send![&*preferences, respondsToSelector: sel!(_setMediaDevicesEnabled:)];
      let getter: Bool = msg_send![&*preferences, respondsToSelector: sel!(_mediaDevicesEnabled)];
      let quirks: Bool = msg_send![&*preferences, respondsToSelector: sel!(_setNeedsSiteSpecificQuirks:)];
      if setter.as_bool() && getter.as_bool() && quirks.as_bool() {
        let _: () = msg_send![&*preferences, _setMediaDevicesEnabled: Bool::NO];
        // Some sites get a separate legacy getUserMedia API via WebKit's compatibility quirks.
        let _: () = msg_send![&*preferences, _setNeedsSiteSpecificQuirks: Bool::NO];
        let enabled: Bool = msg_send![&*preferences, _mediaDevicesEnabled];
        if !enabled.as_bool() {
          return Ok(());
        }
      }
      return Err(io::Error::other("WebKit media devices could not be disabled").into());
    }
    WINDOWS.with_borrow_mut(|w| w.insert(view as *const WKWebView as usize, hears));
    let delegate: Retained<AnyObject> = msg_send![view, UIDelegate];
    let class = *CLASS.get_or_init(|| {
      let mut class = ClassBuilder::new(c"SeismicWebViewUIDelegate", delegate.class()).expect("one subclass of wry's UI delegate");
      class.add_method(
        sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:),
        decide as unsafe extern "C-unwind" fn(_, _, _, _, _, _, _),
      );
      class.register() as *const AnyClass as usize
    });
    AnyObject::set_class(&delegate, &*(class as *const AnyClass));
  }
  Ok(())
}

/// The check (scripts/check-app.ts) on a Mac nobody sits at: with the display asleep or the screen
/// locked every window counts as occluded, and WebKit holds a microphone request until the view is
/// visible again (its timers slow to a crawl too). Without occlusion detection the view counts as
/// visible while its window is on screen.
unsafe fn visible_unattended(webview: &WKWebView) {
  let supported: Bool = msg_send![webview, respondsToSelector: sel!(_setWindowOcclusionDetectionEnabled:)];
  if supported.as_bool() {
    let _: () = msg_send![webview, _setWindowOcclusionDetectionEnabled: Bool::NO];
  }
}

/// The check (scripts/check-app.ts `--fake-mic`) on a machine without a microphone, a Mac Studio
/// say: WebKit's mock capture devices stand in, through its private preference, as Chromium's fake
/// device does for WebView2. With the prompt preference on, every request still comes to `decide`
/// below; only the system's own permission is not asked.
unsafe fn mock_capture_devices(webview: &WKWebView) {
  // a copy of the configuration, but its preferences are the view's own
  let configuration: Retained<AnyObject> = msg_send![webview, configuration];
  let preferences: Retained<AnyObject> = msg_send![&*configuration, preferences];
  let supported: Bool = msg_send![&*preferences, respondsToSelector: sel!(_setMockCaptureDevicesEnabled:)];
  let prompts: Bool = msg_send![&*preferences, respondsToSelector: sel!(_setMockCaptureDevicesPromptEnabled:)];
  if supported.as_bool() && prompts.as_bool() {
    let _: () = msg_send![&*preferences, _setMockCaptureDevicesEnabled: Bool::YES];
    let _: () = msg_send![&*preferences, _setMockCaptureDevicesPromptEnabled: Bool::YES];
  }
}

unsafe extern "C-unwind" fn decide(
  _: &AnyObject,
  _: Sel,
  view: &WKWebView,
  top: &WKSecurityOrigin,
  frame: &WKFrameInfo,
  capture: WKMediaCaptureType,
  reply: &Block<dyn Fn(WKPermissionDecision)>,
) {
  // the origin argument is the top document's: the initiating frame's must be the same
  let frame_origin = unsafe { frame.securityOrigin() };
  let url = http_origin(&frame_origin).filter(|url| http_origin(top).as_ref() == Some(url));
  let hears = WINDOWS.with_borrow(|w| w.get(&(view as *const WKWebView as usize)).cloned());
  let allowed = matches!((hears, url), (Some(hears), Some(url)) if hears(&url));
  let decision = if allowed && capture == WKMediaCaptureType::Microphone {
    WKPermissionDecision::Grant
  } else {
    WKPermissionDecision::Deny
  };
  reply.call((decision,));
}

fn http_origin(origin: &WKSecurityOrigin) -> Option<Url> {
  let (scheme, host, port) = unsafe { (origin.protocol().to_string(), origin.host().to_string(), origin.port()) };
  if !matches!(scheme.as_str(), "http" | "https") || host.is_empty() {
    return None;
  }
  let host = if host.contains(':') && !host.starts_with('[') {
    format!("[{host}]")
  } else {
    host
  };
  let port = if port == 0 { String::new() } else { format!(":{port}") };
  Url::parse(&format!("{scheme}://{host}{port}/")).ok()
}
