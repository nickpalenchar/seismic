// A remote workspace's device cookie belongs to the webview. Ask its server through that page,
// and also read the page's own holds, which can be newer than the server's WebSocket state.

use std::{
  collections::HashMap,
  sync::mpsc,
  thread,
  time::{Duration, Instant},
};

use tauri::{AppHandle, Webview};

use crate::{
  desks,
  window::{drafts::{self, RESTART_HELD, SESSION_DRAFTS}, Own},
};

fn page(app: &AppHandle) -> Option<(Webview, Own)> {
  let webview = desks::active_view(app)?;
  let (_, own) = desks::shell(app).desk_of(webview.label())?;
  own.at(&webview.url().ok()?).then_some((webview, own))
}

pub type Drafts = HashMap<String, Vec<(String, String)>>;

pub fn ready(app: &AppHandle, hand_over: bool) -> Option<Drafts> {
  probe(app, hand_over, hand_over)
}

pub fn probe(app: &AppHandle, snapshot: bool, hand_over: bool) -> Option<Drafts> {
  let Some((w, own)) = page(app) else { return Some(HashMap::new()) };
  probe_page(app, w, own, snapshot, hand_over)
}

fn probe_page(app: &AppHandle, w: Webview, own: Own, snapshot: bool, hand_over: bool) -> Option<Drafts> {
  let origin = own.origin()?;
  if matches!(own, Own::Local(_)) {
    // The local server is checked by the caller. Read drafts here, including when
    // that server has already stopped and its page is still displaying.
    if snapshot {
      let (_, entries) = drafts::sample(&w, &origin, Duration::from_secs(2))?;
      return Some(HashMap::from([(w.label().to_string(), entries)]));
    }
    return Some(HashMap::new());
  }
  let token = crate::now_ms().to_string();
  let js = format!(
      r#"(() => {{
        if (location.origin !== {origin:?}) return;
        const check = {{ token: {token:?}, ready: null }};
        window.seismicRebuildCheck = check;
        (async () => {{
          if (({RESTART_HELD})()) return false;
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
          return !({RESTART_HELD})();
        }})().then((ready) => {{ check.ready = ready; }}, () => {{ check.ready = false; }});
      }})()"#
    );
  w.eval(js).ok()?;
  let deadline = Instant::now() + Duration::from_secs(3);
  loop {
    let (send, receive) = mpsc::channel();
    let js = format!(
      r#"(() => {{
        const check = window.seismicRebuildCheck;
        if (location.origin !== {origin:?} || check?.token !== {token:?} || ({RESTART_HELD})()) return false;
        if (check.ready !== true || !{snapshot}) return check.ready;
        return ({SESSION_DRAFTS})();
      }})()"#
    );
    w.eval_with_callback(js, move |value| {
      let _ = send.send(value);
    }).ok()?;
    let value = receive.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
    let entries = match value.as_str() {
      "false" => return None,
      "" | "null" => None,
      "true" => Some(HashMap::new()),
      _ => Some(HashMap::from([(w.label().to_string(), serde_json::from_str(&value).ok()?)])),
    };
    if let Some(entries) = entries {
      return (page(app) == Some((w, own))).then_some(entries);
    }
    if Instant::now() >= deadline {
      return None;
    }
    thread::sleep(Duration::from_millis(50));
  }
}

/// Recheck remote activity after the local server has answered. Then close the
/// gap between checking the page and exiting by holding input through the commit.
pub fn hold_for_rebuild(app: &AppHandle) -> Option<(Drafts, Option<desks::CaptureHold>)> {
  let Some((w, own)) = page(app) else { return Some((HashMap::new(), None)) };
  if !matches!(own, Own::Local(_)) {
    probe_page(app, w.clone(), own.clone(), false, false)?;
  }
  let hold = desks::CaptureHold::acquire(app, w.label().to_string()).ok()?;
  let (_, entries) = drafts::sample_for_rebuild(&w, &own.origin()?)?;
  (page(app).as_ref() == Some(&(w.clone(), own))).then(|| {
    (HashMap::from([(w.label().to_string(), entries)]), Some(hold))
  })
}
