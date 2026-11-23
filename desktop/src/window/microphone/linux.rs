// WebKitGTK does not name who asks for the microphone, only the page committed in the window: the
// window's frames of other origins are kept out, so a request can only come from its own origin.
use std::{cell::RefCell, rc::Rc};

use tauri::{webview::PlatformWebview, Url};
use webkit2gtk::{
  glib::prelude::Cast, LoadEvent, PermissionRequestExt, PolicyDecisionExt, PolicyDecisionType, ResponsePolicyDecision, ResponsePolicyDecisionExt, SettingsExt,
  URIResponseExt, UserContentManagerExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt,
};

use super::Hears;

pub fn install(webview: PlatformWebview, hears: Hears) {
  let webview = webview.inner();
  if let Some(manager) = webview.user_content_manager() {
    manager.unregister_script_message_handler("ipc");
  }
  // The document shown is the one last committed, until the next commit: a navigation that ends
  // without one (a download, a load that failed or was stopped) leaves it in place, with its
  // microphone, so the start of a load changes nothing here.
  let committed = Rc::new(RefCell::new(None::<Url>));
  let loading = committed.clone();
  webview.connect_load_changed(move |webview, event| {
    if event == LoadEvent::Committed {
      *loading.borrow_mut() = webview.uri().and_then(|uri| Url::parse(&uri).ok());
    }
  });
  // Embedded documents stay on the committed page's origin, so they cannot use its grant from
  // another origin. The response's URI covers redirected frame loads too.
  let framing = committed.clone();
  webview.connect_decide_policy(move |_, decision, kind| {
    if kind != PolicyDecisionType::Response {
      return false;
    }
    let Some(response) = decision.dynamic_cast_ref::<ResponsePolicyDecision>() else {
      return false;
    };
    if response.is_main_frame_main_resource() {
      return false;
    }
    let uri = response.response().and_then(|response| response.uri()).and_then(|uri| Url::parse(&uri).ok());
    if uri.is_some_and(|uri| framing.borrow().as_ref().is_some_and(|top| top.origin() == uri.origin())) {
      return false;
    }
    decision.ignore();
    true
  });
  webview.connect_permission_request(move |_, request| {
    let Some(media) = request.dynamic_cast_ref::<UserMediaPermissionRequest>() else {
      return false;
    };
    if !media.is_for_video_device() && media.is_for_audio_device() && committed.borrow().as_ref().is_some_and(|url| hears(url)) {
      request.allow();
    } else {
      request.deny();
    }
    true
  });
  if let Some(settings) = webview.settings() {
    // getUserMedia is off in WebKitGTK unless the app turns it on
    settings.set_enable_media_stream(true);
    settings.set_enable_mediasource(true);
  }
}
