// A remote workspace's device cookie belongs to the webview. Ask its server through that page,
// and also read the page's own holds, which can be newer than the server's WebSocket state.

use std::{
  collections::HashMap,
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

pub type Drafts = HashMap<String, Vec<(String, String)>>;

pub fn ready(app: &AppHandle, hand_over: bool) -> Option<Drafts> {
  let windows = pages(app)?;
  if windows.is_empty() {
    return Some(HashMap::new());
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
            if (response.status >= 500 && response.status <= 599) return window.seismicRestartHeld?.() === false;
            const state = await response.json().catch(() => null);
            if (response.status === 401) return state?.code === 'notPaired';
            if (!response.ok || state?.now !== true) return false;
          }} catch {{
            // A disconnected page can still know whether its own recording or playback is active.
            return window.seismicRestartHeld?.() === false;
          }} finally {{
            clearTimeout(timeout);
          }}
          // This hook also indicates support for handover storage scoped to the paired device.
          if ({hand_over} && window.seismicRestartHeld) {{
            if (window.seismicRestartHeld()) return false;
            // The local draft snapshot is authoritative. Server handover is best-effort
            // and must finish within the time left in this probe.
            const handover = new AbortController();
            let timer;
            try {{
              await Promise.race([
                window.seismicHandOver?.(check.token, handover.signal),
                new Promise((resolve) => {{
                  timer = setTimeout(() => {{ handover.abort(); resolve(); }}, 600);
                }}),
              ]);
            }} catch {{}} finally {{
              clearTimeout(timer);
            }}
          }}
          return !window.seismicRestartHeld?.();
        }})().then((ready) => {{ check.ready = ready; }}, () => {{ check.ready = false; }});
      }})()"#
    );
    w.eval(js).ok()?;
  }
  let deadline = Instant::now() + Duration::from_secs(3);
  loop {
    let (send, receive) = mpsc::channel();
    for (w, origin) in &windows {
      let send = send.clone();
      let label = w.label().to_string();
      let js = format!(
        r#"(() => {{
          const check = window.seismicRebuildCheck;
          if (location.origin !== {origin:?} || check?.token !== {token:?} || window.seismicRestartHeld?.()) return false;
          // Keep an origin-scoped copy even after a successful server handover: it can expire
          // during installation or before a workspace comes back online.
          if (check.ready !== true || !{hand_over}) return check.ready;
          const entries = window.seismicSnapshotSession?.() ?? Object.entries(sessionStorage);
          return entries.filter(([key]) => /^(seismic-(drafts|markups|setting-draft|kept)-)/.test(key));
        }})()"#
      );
      w.eval_with_callback(js, move |value| {
        let _ = send.send((label.clone(), value));
      })
      .ok()?;
    }
    drop(send);
    let mut all_ready = true;
    let mut drafts = HashMap::new();
    for _ in 0..windows.len() {
      let (label, value) = receive.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
      match value.as_str() {
        "true" => {}
        "false" => return None,
        "" | "null" => all_ready = false, // the fetch or handover is still in flight
        _ => {
          let entries: Vec<(String, String)> = serde_json::from_str(&value).ok()?;
          drafts.insert(label, entries);
        }
      }
    }
    if all_ready {
      return pages(app).is_some_and(|now| now == windows).then_some(drafts);
    }
    if Instant::now() >= deadline {
      return None;
    }
    thread::sleep(Duration::from_millis(50));
  }
}
