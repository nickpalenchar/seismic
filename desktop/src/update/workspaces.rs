// A remote workspace's device cookie belongs to the webview. Ask its server through that page,
// and also read the page's own holds, which can be newer than the server's WebSocket state.

use std::{
  sync::mpsc,
  thread,
  time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{desks, window::Own};

fn pages(app: &AppHandle) -> Option<Vec<(WebviewWindow, String)>> {
  let mut pages = Vec::new();
  for w in app.webview_windows().into_values() {
    let Some((_, Some(origin))) = desks::shell(app).desk_of(w.label()) else {
      continue;
    };
    if Own::Remote(origin.clone()).at(&w.url().ok()?) {
      pages.push((w, origin));
    }
  }
  pages.sort_by(|(a, _), (b, _)| a.label().cmp(b.label()));
  Some(pages)
}

pub fn ready(app: &AppHandle, hand_over: bool) -> bool {
  let Some(windows) = pages(app) else { return false };
  if windows.is_empty() {
    return true;
  }
  let token = crate::now_ms().to_string();
  for (w, origin) in &windows {
    let js = format!(
      r#"(() => {{
        if (location.origin !== {origin:?}) return;
        const check = {{ token: {token:?}, ready: null }};
        window.seismicRebuildCheck = check;
        (async () => {{
          if (window.seismicRestartHeld?.()) return false;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2000);
          try {{
            const response = await fetch('/api/app-rebuilt', {{
              method: 'POST', headers: {{ 'content-type': 'application/json' }}, body: '{{}}',
              signal: controller.signal,
            }});
            if (!response.ok || (await response.json()).now !== true) return false;
          }} catch {{
            // A disconnected page can still know whether its own recording or playback is active.
            return window.seismicRestartHeld?.() === false;
          }} finally {{
            clearTimeout(timeout);
          }}
          // This hook also indicates support for handover storage scoped to the paired device.
          if ({hand_over} && window.seismicRestartHeld) {{
            if (window.seismicRestartHeld() || !window.seismicHandOver) return false;
            await window.seismicHandOver(check.token);
          }}
          return !window.seismicRestartHeld?.();
        }})().then((ready) => {{ check.ready = ready; }}, () => {{ check.ready = false; }});
      }})()"#
    );
    if w.eval(js).is_err() {
      return false;
    }
  }
  let deadline = Instant::now() + Duration::from_secs(3);
  loop {
    let (send, receive) = mpsc::channel();
    for (w, origin) in &windows {
      let send = send.clone();
      let js = format!(
        "location.origin === {origin:?} && window.seismicRebuildCheck?.token === {token:?} && !window.seismicRestartHeld?.() ? window.seismicRebuildCheck.ready : false"
      );
      if w
        .eval_with_callback(js, move |value| {
          let _ = send.send(serde_json::from_str::<bool>(&value).ok());
        })
        .is_err()
      {
        return false;
      }
    }
    drop(send);
    let mut all_ready = true;
    for _ in 0..windows.len() {
      match receive.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(Some(true)) => {}
        Ok(None) => all_ready = false, // the fetch or handover is still in flight
        _ => return false,
      }
    }
    if all_ready {
      return pages(app).is_some_and(|now| now == windows);
    }
    if Instant::now() >= deadline {
      return false;
    }
    thread::sleep(Duration::from_millis(50));
  }
}
