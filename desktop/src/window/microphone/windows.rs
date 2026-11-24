// WebView2 names the origin of the requesting frame. Wry's permission callback drops it and saves
// Allow in the profile, where it could outlive the workspace.
use std::{
  cell::RefCell,
  sync::atomic::{AtomicBool, Ordering},
};

use tauri::{Url, WebviewWindow};
use webview2_com::{
  take_pwstr, GetNonDefaultPermissionSettingsCompletedHandler, Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler,
  SetPermissionStateCompletedHandler,
};
use windows_core::{Interface, PWSTR};

use super::Hears;

/// The saved grants of older versions go once a run: the profile is the windows' one.
static CLEARED: AtomicBool = AtomicBool::new(false);

fn controlled(kind: COREWEBVIEW2_PERMISSION_KIND) -> bool {
  kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
}

pub fn install(window: &WebviewWindow, hears: Hears) -> tauri::Result<()> {
  // Window construction runs on the UI thread, so with_webview delivers the controller here.
  // Pump messages to clear the profile only after the callback returns to release wry's borrow.
  thread_local! {
    static CONTROLLER: RefCell<Option<ICoreWebView2Controller>> = const { RefCell::new(None) };
  }
  window.with_webview(|webview| CONTROLLER.set(Some(webview.controller())))?;
  let controller = CONTROLLER.take().ok_or_else(|| std::io::Error::other("WebView2 controller unavailable"))?;
  configure(controller, hears).map_err(|error| std::io::Error::other(error.to_string()).into())
}

fn configure(controller: ICoreWebView2Controller, hears: Hears) -> webview2_com::Result<()> {
  unsafe {
    let webview = controller.CoreWebView2()?;
    if !CLEARED.load(Ordering::SeqCst) {
      let profile = webview.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile4>()?;
      clear_saved_grants(&profile)?;
      CLEARED.store(true, Ordering::SeqCst);
    }
    webview.add_PermissionRequested(
      &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else { return Ok(()) };
        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
        args.PermissionKind(&mut kind)?;
        if !controlled(kind) {
          return Ok(());
        }
        // decided here for every origin: Default would defer to the browser's permission state
        args.cast::<ICoreWebView2PermissionRequestedEventArgs3>()?.SetSavesInProfile(false)?;
        let mut uri = PWSTR::null();
        let allowed = kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
          && args.Uri(&mut uri).is_ok()
          && !uri.is_null()
          && Url::parse(&take_pwstr(uri)).is_ok_and(|url| hears(&url));
        args.SetState(if allowed {
          COREWEBVIEW2_PERMISSION_STATE_ALLOW
        } else {
          COREWEBVIEW2_PERMISSION_STATE_DENY
        })
      })),
      &mut 0,
    )?;
  }
  Ok(())
}

/// Resets grants from older versions. A persisted grant can suppress PermissionRequested entirely.
/// The rest of the profile stays, the cookies among it.
fn clear_saved_grants(profile: &ICoreWebView2Profile4) -> webview2_com::Result<()> {
  let (send, receive) = std::sync::mpsc::channel();
  let query = profile.clone();
  GetNonDefaultPermissionSettingsCompletedHandler::wait_for_async_operation(
    Box::new(move |handler| unsafe { query.GetNonDefaultPermissionSettings(&handler).map_err(Into::into) }),
    Box::new(move |result, settings| {
      result?;
      let mut grants = Vec::new();
      if let Some(settings) = settings {
        unsafe {
          let mut count = 0;
          settings.Count(&mut count)?;
          for i in 0..count {
            let setting = settings.GetValueAtIndex(i)?;
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            let mut state = COREWEBVIEW2_PERMISSION_STATE::default();
            setting.PermissionKind(&mut kind)?;
            setting.PermissionState(&mut state)?;
            if controlled(kind) && state == COREWEBVIEW2_PERMISSION_STATE_ALLOW {
              let mut origin = PWSTR::null();
              setting.PermissionOrigin(&mut origin)?;
              grants.push((kind, take_pwstr(origin)));
            }
          }
        }
      }
      let _ = send.send(grants);
      Ok(())
    }),
  )?;
  for (kind, origin) in receive.try_iter().flatten() {
    let profile = profile.clone();
    SetPermissionStateCompletedHandler::wait_for_async_operation(
      Box::new(move |handler| unsafe {
        profile
          .SetPermissionState(
            kind,
            &windows_core::HSTRING::from(origin),
            COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
            &handler,
          )
          .map_err(Into::into)
      }),
      Box::new(|result| result),
    )?;
  }
  Ok(())
}
