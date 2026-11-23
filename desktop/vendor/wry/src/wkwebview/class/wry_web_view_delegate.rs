// Copyright 2020-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{ffi::CStr, panic::AssertUnwindSafe};

use http::Request;
use objc2::{
  DeclaredClass, MainThreadOnly, define_class, msg_send,
  rc::Retained,
  runtime::{NSObject, ProtocolObject},
};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSString, ns_string};
use objc2_web_kit::{WKFrameInfo, WKScriptMessage, WKScriptMessageHandler, WKUserContentController};

pub const IPC_MESSAGE_HANDLER_NAME: &str = "ipc";

pub struct WryWebViewDelegateIvars {
  pub controller: Retained<WKUserContentController>,
  pub ipc_handler: Box<dyn Fn(Request<String>)>,
}

define_class!(
  #[unsafe(super(NSObject))]
  #[thread_kind = MainThreadOnly]
  #[ivars = WryWebViewDelegateIvars]
  pub struct WryWebViewDelegate;

  unsafe impl NSObjectProtocol for WryWebViewDelegate {}

  unsafe impl WKScriptMessageHandler for WryWebViewDelegate {
    // Function for ipc handler
    #[unsafe(method(userContentController:didReceiveScriptMessage:))]
    fn did_receive(
      this: &WryWebViewDelegate,
      _controller: &WKUserContentController,
      msg: &WKScriptMessage,
    ) {
      // Safety: objc runtime calls are unsafe
      unsafe {
        #[cfg(feature = "tracing")]
        let _span = tracing::info_span!(parent: None, "wry::ipc::handle").entered();

        let ipc_handler = &this.ivars().ipc_handler;
        let body = msg.body();
        // Seismic's patch (desktop/vendor/README.md): only the main frame, at its document's own
        // effective origin, may send IPC. The handler names a call by the frame's document URL,
        // which a sandboxed frame (opaque origin) or a subframe shares with the page.
        if !main_frame_at_its_origin(&msg.frameInfo()) {
          #[cfg(feature = "tracing")]
          tracing::warn!("WebView dropped an IPC call from a subframe or an opaque origin.");
          return;
        }
        if let Ok(body) = body.downcast::<NSString>() {
          let js_utf8 = body.UTF8String();

          let frame_info = msg.frameInfo();
          let request = frame_info.request();
          let url = request.URL().unwrap();
          let absolute_url = url.absoluteString().unwrap();
          let url_utf8 = absolute_url.UTF8String();

          if let (Ok(url), Ok(js)) = (
            CStr::from_ptr(url_utf8).to_str(),
            CStr::from_ptr(js_utf8).to_str(),
          ) {
            if let Ok(r) = Request::builder().uri(url).body(js.to_string()) {
              ipc_handler(r);
            } else {
              #[cfg(feature = "tracing")]
              tracing::warn!("WebView received invalid IPC request: {}", js);
            }
            return;
          }
        }

        #[cfg(feature = "tracing")]
        tracing::warn!("WebView received invalid IPC call.");
      }
    }
  }
);

/// Whether `frame` is the main frame and its security origin is its document URL's origin. An
/// opaque origin (a sandboxed document) reports an empty protocol; a default port reports 0.
fn main_frame_at_its_origin(frame: &WKFrameInfo) -> bool {
  // Safety: objc runtime calls are unsafe
  unsafe {
    if !frame.isMainFrame() {
      return false;
    }
    let origin = frame.securityOrigin();
    let (protocol, host, port) = (origin.protocol().to_string(), origin.host().to_string(), origin.port());
    if protocol.is_empty() {
      return false;
    }
    let Some(url) = frame.request().URL() else { return false };
    let (Some(scheme), Some(url_host)) = (url.scheme(), url.host()) else { return false };
    let url_port = url.port().map(|p| p.integerValue()).unwrap_or(0);
    let default = |scheme: &str| match scheme {
      "http" => 80,
      "https" => 443,
      _ => 0,
    };
    let normal = |port: isize| if port == default(&protocol) { 0 } else { port };
    scheme.to_string().eq_ignore_ascii_case(&protocol)
      && url_host.to_string().eq_ignore_ascii_case(host.trim_start_matches('[').trim_end_matches(']'))
      && normal(url_port) == normal(port as isize)
  }
}

impl WryWebViewDelegate {
  pub fn new(
    controller: Retained<WKUserContentController>,
    ipc_handler: Box<dyn Fn(Request<String>)>,
    mtm: MainThreadMarker,
  ) -> Retained<Self> {
    let delegate = mtm
      .alloc::<WryWebViewDelegate>()
      .set_ivars(WryWebViewDelegateIvars {
        ipc_handler,
        controller,
      });

    let delegate: Retained<Self> = unsafe { msg_send![super(delegate), init] };

    let proto_delegate = ProtocolObject::from_ref(&*delegate);
    unsafe {
      // this will increase the retain count of the delegate
      let _res = objc2::exception::catch(AssertUnwindSafe(|| {
        delegate
          .ivars()
          .controller
          .addScriptMessageHandler_name(proto_delegate, ns_string!(IPC_MESSAGE_HANDLER_NAME));
      }));
    }

    delegate
  }
}
