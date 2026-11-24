use super::placed::Placed;
use tauri::{AppHandle, Webview};

const MAX_DRAFT_BYTES: usize = 32 * 1024 * 1024;

// Shared by restart sampling and the workspace's departure snapshot. Session storage also contains
// temporary UI state and pairing setup; only unsent work belongs in a durable copy.
pub const SESSION_DRAFTS: &str = r#"(entries) => {
  if (entries === undefined) {
    if (window.seismicSnapshotSession) entries = window.seismicSnapshotSession();
    else {
      let stored = [];
      try { stored = Object.entries(sessionStorage); } catch {}
      entries = stored;
    }
    if (window.seismicDraftOverflow) entries = [...new Map([...entries, ...window.seismicDraftOverflow])];
  }
  return entries.filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' &&
    /^seismic-(drafts|markups|setting-draft|kept|wish|config-draft)-/.test(entry[0]));
}"#;

/// Read the current document's route and drafts before the old webview closes.
pub fn sample(webview: &Webview, origin: &str, timeout: std::time::Duration) -> Option<(String, Vec<(String, String)>)> {
  let (send, receive) = std::sync::mpsc::channel();
  let script = format!(r#"location.origin === {} ? [location.href, ({SESSION_DRAFTS})()] : null"#, serde_json::json!(origin));
  webview.eval_with_callback(script, move |value| {
    let _ = send.send(value);
  }).ok()?;
  let text = receive.recv_timeout(timeout).ok()?;
  let (url, entries): (String, Vec<(String, String)>) = serde_json::from_str(&text).ok()?;
  let url = tauri::Url::parse(&url).ok()?;
  (url.origin().ascii_serialization() == origin).then(|| (crate::next_of(&url), entries))
}

#[tauri::command]
pub fn workspace_draft_checkpoint(app: AppHandle, webview: Webview, activation: f64, url: String, entries: Option<Vec<(String, String)>>, received: bool) {
  receive(&crate::desks::shell(&app), webview.label(), activation, &url, entries, received);
}

#[tauri::command]
pub fn workspace_restore_drafts(app: AppHandle, webview: Webview, activation: f64, settle: Option<bool>) -> Result<Option<crate::desks::DraftOffer>, &'static str> {
  let shell = crate::desks::shell(&app);
  if settle == Some(true) {
    crate::desks::settle_departure(&shell, webview.label(), activation);
    return Ok(None);
  }
  crate::desks::restore_departure(&shell, webview.label(), activation)
}

fn receive(shell: &crate::desks::Shell, label: &str, activation: f64, url: &str, entries: Option<Vec<(String, String)>>, received: bool) {
  if !activation.is_finite() || activation <= 0.0 {
    return;
  }
  let prefixes = ["seismic-drafts-", "seismic-markups-", "seismic-setting-draft-", "seismic-kept-", "seismic-wish-", "seismic-config-draft-"];
  let entries = entries.and_then(|mut entries| {
    entries.retain(|(key, _)| prefixes.iter().any(|prefix| key.starts_with(prefix)));
    (entries.iter().map(|(k, v)| k.len() + v.len()).sum::<usize>() <= MAX_DRAFT_BYTES).then_some(entries)
  });
  crate::desks::departure(shell, label, activation, url, entries, received);
}

#[cfg(target_os = "linux")]
pub fn install(window: &tauri::Webview, token: String) -> tauri::Result<()> {
  use tauri::Manager;
  use webkit2gtk::{UserContentManagerExt, WebViewExt};

  // GTK does not identify the message's frame or origin. The content script gives only this
  // window's own top document a secret for this one-way channel. Generic IPC stays disabled.
  let label = window.label().to_string();
  let expected = format!("[\"{token}\",");
  let shell = std::sync::Arc::downgrade(&crate::desks::shell(window.app_handle()));
  window.with_webview(move |webview| {
    let Some(manager) = webview.inner().user_content_manager() else { return };
    manager.connect_script_message_received(Some("seismicDrafts"), move |_, message| {
      let Some(value) = message.js_value() else { return };
      let message = value.to_string();
      if !message.starts_with(&expected) || message.len() > MAX_DRAFT_BYTES * 2 {
        return;
      }
      let Ok((_, activation, url, entries, received)) = serde_json::from_str::<(String, f64, String, Option<Vec<(String, String)>>, bool)>(&message) else { return };
      if let Some(shell) = shell.upgrade() {
        receive(&shell, &label, activation, &url, entries, received);
      }
    });
    manager.register_script_message_handler("seismicDrafts");
  })
}

pub fn script(origin: &str, restore: Option<&Placed>, message_key: &str) -> String {
  let checkpoint = restore.and_then(|p| p.draft_checkpoint).map(|id| id.to_string());
  let drafts = restore.map(|p| p.drafts.as_slice()).unwrap_or_default();
  format!(
    r#"(() => {{
      if (window.top !== window || location.origin !== {}) return;
      const key = 'seismic-desktop-departed-drafts';
      const oldCheckpoint = {};
      const save = {SESSION_DRAFTS};
      const messageKey = {};
      const api = window.__TAURI_INTERNALS__;
      const usesTauri = {};
      const bridge = usesTauri ? window.ipc : window.webkit?.messageHandlers?.seismicDrafts;
      const post = bridge?.postMessage?.bind(bridge);
      const stringify = JSON.stringify.bind(JSON);
      const command = 'workspace_draft_checkpoint';
      const received = 'seismic-desktop-restored';
      let activation;
      let reloading = false;
      function send(entries, received = false) {{
        const url = location.href;
        const payload = {{ activation, url, entries, received }};
        // Hand the data to the native message queue before the document goes away.
        if (usesTauri) {{
          const callback = api.transformCallback(() => {{}}, true);
          post?.(stringify({{ cmd: command, callback, error: callback, payload, __TAURI_INVOKE_KEY__: messageKey }}));
        }} else {{
          post?.(stringify([messageKey, activation, url, entries, received]));
        }}
      }}
      function begin() {{
        activation = performance.timeOrigin + performance.now();
        send(null);
      }}
      function apply(entries, overwrite) {{
        const overflow = new Map(window.seismicDraftOverflow ?? []);
        for (const [key, value] of entries) {{
          try {{
            if (overwrite || sessionStorage.getItem(key) === null) {{
              sessionStorage.setItem(key, value);
              overflow.delete(key);
            }}
          }} catch {{ overflow.set(key, value); }}
        }}
        window.seismicDraftOverflow = overflow.size ? [...overflow] : undefined;
      }}
      async function restoreDeparture(active, resumedFrom) {{
        // The native activation message and this request may arrive on different transports.
        // Wait briefly for that exact activation, without holding startup if IPC is unavailable.
        const deadline = performance.now() + 1000;
        while (active === activation && performance.now() < deadline) {{
          let timeout;
          try {{
            const offer = await Promise.race([
              api.invoke('workspace_restore_drafts', {{ activation: active }}),
              new Promise((resolve) => {{ timeout = setTimeout(resolve, deadline - performance.now()); }}),
            ]);
            if (!offer || active !== activation) return;
            const [from, entries] = offer;
            const confirm = () => {{
              if (activation === active) try {{ send(null, true); }} catch {{}}
            }};
            if (resumedFrom !== undefined) {{
              // Forward can revive the exact document that made the copy. If history revives an
              // older one, restart its editors with the current copy and keep the backup until then.
              if (from === resumedFrom) confirm();
              else {{
                send([]);
                reloading = true;
                location.reload();
              }}
              return;
            }}
            for (const [key] of entries) window.seismicRestoredDrafts.add(key);
            apply(entries, true);
            if (window.seismicDraftOverflow) window.seismicConfirmDeparture = confirm;
            else confirm();
            return;
          }} catch (error) {{
            if (error !== 'pending') return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }} finally {{ clearTimeout(timeout); }}
        }}
        // The editors start without the copy. One that comes later fills only what this document lacks.
        if (active === activation) api.invoke('workspace_restore_drafts', {{ activation: active, settle: true }}).catch(() => {{}});
      }}
      let entries = {};
      if (oldCheckpoint) try {{
        // Recover copies published by the earlier shell before its next restart consumes them.
        const checkpoint = JSON.parse(localStorage.getItem(key));
        if (checkpoint?.windowId === oldCheckpoint && Array.isArray(checkpoint.entries)) entries = save(checkpoint.entries);
      }} catch {{}}
      window.seismicRestoredDrafts = new Set(entries.map(([key]) => key));
      let alreadyRestored = false;
      try {{
        alreadyRestored = sessionStorage.getItem(received) === '1';
        // Reserve the marker before the restored drafts can fill the store.
        if (!alreadyRestored) sessionStorage.setItem(received, '1');
      }} catch {{}}
      if (!alreadyRestored) {{
        apply(entries, false);
      }}
      if (!window.seismicDraftOverflow) {{
        window.seismicDraftsReceived = true;
        // Clean up the previous shell's departure copy after restoring the session.
        try {{ localStorage.removeItem(key); }} catch {{}}
      }}
      begin();
      window.seismicDraftsReady = restoreDeparture(activation);
      addEventListener('pageshow', (event) => {{
        if (event.persisted) {{
          const previous = activation;
          begin();
          const root = document.documentElement;
          const inert = root.inert;
          root.inert = true;
          void restoreDeparture(activation, previous).finally(() => {{ root.inert = inert; }});
        }}
      }});
      addEventListener('pagehide', () => {{
        if (!reloading) try {{ send(save()); }} catch {{}}
      }});
    }})();"#,
    serde_json::json!(origin),
    serde_json::json!(checkpoint),
    serde_json::json!(message_key),
    !cfg!(target_os = "linux"),
    serde_json::json!(drafts)
  )
}
