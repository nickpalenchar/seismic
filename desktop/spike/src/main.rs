// The desktop workspace spike (docs/design/desktop-workspaces.md). `run.ts` beside it starts the
// servers (this machine's Seismic and two remote workspaces, plus a foreign origin), runs this
// binary and judges what both report. Each run:
//
// - opens `main` at this machine's origin, with a capability that grants it `ping_local`;
// - pairs each workspace over HTTP or HTTPS (`POST /api/pair` with its code), then grants a capability for
//   that workspace's window and origin alone (`ping_a` or `ping_b`) and opens the window at the
//   one-time login link the server answered (`SPIKE_RUN=first`), or at the start page
//   (`SPIKE_RUN=again`, a relaunch that has to find the device cookie still there);
// - keeps each window on its origin with the navigation hook, handing new windows off; with
//   `SPIKE_GUARD=off` the hook lets everything through, so a foreign frame loads and the capability
//   alone has to turn its calls away;
// - reports every hook call, page load and command that ran to the harness, and quits after
//   SPIKE_SECONDS.
//
// On Windows the shell also guards frames (FrameNavigationStarting), which wry's hook does not see.
// On Linux and macOS `SPIKE_POSTMESSAGE=off` unregisters wry's postMessage IPC (the backup branch's
// fix on Linux), as wry attributes such a call to the page the webview shows (Linux) or to the
// frame's document URL whatever its effective origin (macOS), not to the frame's origin.

use std::time::Duration;

use tauri::{ipc::CapabilityBuilder, webview::NewWindowResponse, AppHandle, Manager, Url, Webview, WebviewUrl, WebviewWindowBuilder};

const HARNESS: &str = "http://127.0.0.1:8900";
const DESKS: [(&str, &str, &str); 2] = [("desk-a", "http://127.0.0.1:8901", "allow-ping-a"), ("desk-b", "http://127.0.0.1:8902", "allow-ping-b")];

fn env(name: &str) -> String {
  std::env::var(name).unwrap_or_default()
}

fn report(event: serde_json::Value) {
  let _ = ureq::post(&format!("{HARNESS}/shell")).send_json(event);
}

fn origin(url: &Url) -> String {
  url.origin().ascii_serialization()
}

/// What a command reports: which window and webview URL Tauri ran it for, and the `Origin` header of
/// its request (none over postMessage).
fn ran(cmd: &str, webview: &Webview, request: &tauri::ipc::Request<'_>, tag: &str) -> String {
  let header = request.headers().get("Origin").and_then(|o| o.to_str().ok()).map(str::to_string);
  let url = webview.url().map(|u| u.to_string()).unwrap_or_default();
  report(serde_json::json!({ "kind": "cmd", "cmd": cmd, "window": webview.window().label(), "url": url, "originHeader": header, "tag": tag }));
  format!("{cmd} ran in {}", webview.window().label())
}

#[tauri::command]
fn ping_a(webview: Webview, request: tauri::ipc::Request<'_>, tag: String) -> String {
  ran("ping_a", &webview, &request, &tag)
}

#[tauri::command]
fn ping_b(webview: Webview, request: tauri::ipc::Request<'_>, tag: String) -> String {
  ran("ping_b", &webview, &request, &tag)
}

#[tauri::command]
fn ping_local(webview: Webview, request: tauri::ipc::Request<'_>, tag: String) -> String {
  ran("ping_local", &webview, &request, &tag)
}

/// The server answers with a one-time login link or a pairing error.
fn pair(origin: &str) -> Result<String, String> {
  let response = ureq::post(&format!("{origin}/api/pair")).send_json(serde_json::json!({ "code": "123456" })).map_err(|e| e.to_string())?;
  let body: serde_json::Value = response.into_json().map_err(|e| e.to_string())?;
  body["link"].as_str().map(str::to_string).ok_or_else(|| body.to_string())
}

fn open(app: &AppHandle, label: &str, own: &str, url: &str, guard: bool) -> tauri::Result<()> {
  let own = own.to_string();
  #[cfg(windows)]
  let own_frames = own.clone();
  #[cfg(target_os = "macos")]
  let own_gate = own.clone();
  let (nav_label, new_label, load_label) = (label.to_string(), label.to_string(), label.to_string());
  let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url.parse().unwrap()))
    .title(label)
    .inner_size(900.0, 700.0)
    .on_navigation(move |url| {
      let allowed = !guard || origin(url) == own;
      report(serde_json::json!({ "kind": "nav", "window": nav_label, "url": url.as_str(), "allowed": allowed }));
      allowed
    })
    .on_new_window(move |url, _| {
      report(serde_json::json!({ "kind": "newWindow", "window": new_label, "url": url.as_str() }));
      NewWindowResponse::Deny
    })
    .on_page_load(move |_, payload| {
      let event = format!("{:?}", payload.event());
      report(serde_json::json!({ "kind": "load", "window": load_label, "event": event, "url": payload.url().as_str() }));
    })
    .build()?;
  #[cfg(target_os = "linux")]
  if env("SPIKE_POSTMESSAGE") == "off" {
    window.with_webview(|webview| {
      use webkit2gtk::{UserContentManagerExt, WebViewExt};
      if let Some(manager) = webview.inner().user_content_manager() {
        manager.unregister_script_message_handler("ipc");
      }
    })?;
  }
  // WKWebView attributes a postMessage call to the frame's document URL, so an opaque-origin
  // sandboxed frame at the workspace's URL passes as the workspace. `off` removes that handler,
  // leaving the fetch IPC, which names its sender by the `Origin` header (`null` for such a frame)
  // but cannot be reached from an https page; `main-frame` keeps it for the window's main frame
  // at the window's own effective origin and drops every other message
  #[cfg(target_os = "macos")]
  match env("SPIKE_POSTMESSAGE").as_str() {
    "off" => window.with_webview(|webview| unsafe {
      let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
      view.configuration().userContentController().removeScriptMessageHandlerForName(objc2_foundation::ns_string!("ipc"));
    })?,
    "main-frame" => {
      let (own, label) = (own_gate, label.to_string());
      window.with_webview(move |webview| main_frame_ipc::admit(webview.inner() as usize, own, label))?;
    }
    _ => {}
  }
  // WebView2 asks wry's hook for main-frame navigations only (NavigationStarting): a frame's goes to
  // FrameNavigationStarting, which the shell has to guard itself
  #[cfg(windows)]
  if guard {
    let own = own_frames;
    let label = label.to_string();
    window.with_webview(move |webview| unsafe {
      use webview2_com::{take_pwstr, NavigationStartingEventHandler};
      let core = webview.controller().CoreWebView2().expect("CoreWebView2");
      let mut token = 0i64;
      let _ = core.add_FrameNavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_, args| {
          let Some(args) = args else { return Ok(()) };
          let mut uri = windows::core::PWSTR::null();
          args.Uri(&mut uri)?;
          let uri = take_pwstr(uri);
          let allowed = uri.parse::<Url>().map(|u| origin(&u) == own).unwrap_or(false) || uri == "about:blank" || uri == "about:srcdoc";
          report(serde_json::json!({ "kind": "frameNav", "window": label, "url": uri, "allowed": allowed }));
          args.SetCancel(!allowed)?;
          Ok(())
        })),
        &mut token,
      );
    })?;
  }
  let _ = window;
  Ok(())
}

/// The `main-frame` gate on WKWebView: wry's script message handler (`WryWebViewDelegate`) runs
/// only for a message from a window's main frame whose security origin is that window's origin.
/// Swapping the method's implementation is the spike's way in; W3 would rather patch wry.
#[cfg(target_os = "macos")]
mod main_frame_ipc {
  use std::{collections::HashMap, sync::{Mutex, Once, OnceLock}};

  use objc2::{runtime::{AnyClass, AnyObject, Imp, Sel}, sel};
  use objc2_web_kit::{WKScriptMessage, WKUserContentController};

  type Handler = unsafe extern "C-unwind" fn(&AnyObject, Sel, &WKUserContentController, &WKScriptMessage);

  static ORIGINAL: OnceLock<Handler> = OnceLock::new();
  static INSTALL: Once = Once::new();
  /// each window's WKWebView (by address) with its origin and label
  static WINDOWS: Mutex<Option<HashMap<usize, (String, String)>>> = Mutex::new(None);

  pub fn admit(view: usize, own: String, label: String) {
    WINDOWS.lock().unwrap().get_or_insert_with(HashMap::new).insert(view, (own, label));
    INSTALL.call_once(|| unsafe {
      // objc2 generates the class's name from wry's `WryWebViewDelegate`, with a suffix of its own
      let class = AnyClass::classes().iter().copied().find(|c| c.name().to_string_lossy().contains("WryWebViewDelegate")).expect("wry's script message handler class");
      let method = class.instance_method(sel!(userContentController:didReceiveScriptMessage:)).expect("its message method");
      let original = method.set_implementation(std::mem::transmute::<Handler, Imp>(gated));
      let _ = ORIGINAL.set(std::mem::transmute::<Imp, Handler>(original));
    });
  }

  unsafe extern "C-unwind" fn gated(this: &AnyObject, cmd: Sel, controller: &WKUserContentController, message: &WKScriptMessage) {
    let frame = message.frameInfo();
    let origin = frame.securityOrigin();
    let (protocol, host, port) = (origin.protocol().to_string(), origin.host().to_string(), origin.port());
    let effective = if protocol.is_empty() { "null".to_string() } else if port == 0 { format!("{protocol}://{host}") } else { format!("{protocol}://{host}:{port}") };
    let view = message.webView().map(|v| &*v as *const _ as usize).unwrap_or(0);
    let window = WINDOWS.lock().unwrap().as_ref().and_then(|w| w.get(&view).cloned());
    let admitted = frame.isMainFrame() && window.as_ref().is_some_and(|(own, _)| *own == effective);
    if !admitted {
      let url = frame.request().URL().and_then(|u| u.absoluteString()).map(|u| u.to_string()).unwrap_or_default();
      super::report(serde_json::json!({
        "kind": "ipcDropped",
        "window": window.as_ref().map(|(_, label)| label),
        "expectedOrigin": window.as_ref().map(|(own, _)| own),
        "mainFrame": frame.isMainFrame(),
        "origin": effective,
        "url": url,
      }));
      return;
    }
    (ORIGINAL.get().expect("original handler"))(this, cmd, controller, message)
  }
}

fn main() {
  let run = env("SPIKE_RUN");
  let https_cookies = env("SPIKE_HTTPS_COOKIES") == "1";
  let guard = env("SPIKE_GUARD") != "off";
  let seconds: u64 = env("SPIKE_SECONDS").parse().unwrap_or(14);
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![ping_a, ping_b, ping_local])
    .setup(move |app| {
      let handle = app.handle().clone();
      // the frame pages get the invoke key, as a page that learned it would have it: the capability
      // is what has to turn their calls away then
      report(serde_json::json!({ "kind": "key", "key": handle.invoke_key(), "os": std::env::consts::OS }));
      if !https_cookies {
        handle.add_capability(CapabilityBuilder::new("main").window("main").local(false).remote(HARNESS.into()).permission("allow-ping-local"))?;
        open(&handle, "main", HARNESS, &format!("{HARNESS}/local"), true)?;
      }
      for (label, own, permission) in DESKS {
        let https_origin;
        let own = if https_cookies {
          https_origin = own.replacen("http:", "https:", 1);
          https_origin.as_str()
        } else {
          own
        };
        let url = if run == "again" {
          format!("{own}/")
        } else {
          match pair(own) {
            Ok(link) => link,
            Err(e) => {
              report(serde_json::json!({ "kind": "pairFailed", "window": label, "error": e }));
              continue;
            }
          }
        };
        report(serde_json::json!({ "kind": "paired", "window": label, "url": url }));
        // one window, one origin, fixed for the window's life
        handle.add_capability(CapabilityBuilder::new(label).window(label).local(false).remote(own.into()).permission(permission))?;
        open(&handle, label, own, &url, guard)?;
      }
      #[cfg(target_os = "macos")]
      if !guard && env("SPIKE_POSTMESSAGE") == "main-frame" {
        // Keep the normal desk windows as positive controls. This window has desk-a's gate
        // origin but starts at desk-b; its document really is a main frame at another origin.
        let scheme = if https_cookies { "https" } else { "http" };
        let own = format!("{scheme}://127.0.0.1:8901");
        let url = format!("{scheme}://127.0.0.1:8902/gate-probe");
        open(&handle, "gate-probe", &own, &url, false)?;
      }
      std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(seconds));
        report(serde_json::json!({ "kind": "quit" }));
        handle.exit(0);
      });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("spike");
}
