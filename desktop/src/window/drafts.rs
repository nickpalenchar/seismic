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
      if (window.seismicDraftOverflow) stored = [...new Map([...stored, ...window.seismicDraftOverflow])];
      entries = stored;
    }
  }
  return entries.filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' &&
    /^seismic-(drafts|markups|setting-draft|kept|wish|config-draft)-/.test(entry[0]));
}"#;

#[tauri::command]
pub fn workspace_draft_checkpoint(app: AppHandle, webview: Webview, activation: f64, url: String, entries: Option<Vec<(String, String)>>) {
  receive(&crate::desks::shell(&app), webview.label(), activation, &url, entries);
}

fn receive(shell: &crate::desks::Shell, label: &str, activation: f64, url: &str, entries: Option<Vec<(String, String)>>) {
  if !activation.is_finite() || activation <= 0.0 {
    return;
  }
  let prefixes = ["seismic-drafts-", "seismic-markups-", "seismic-setting-draft-", "seismic-kept-", "seismic-wish-", "seismic-config-draft-"];
  let entries = entries.and_then(|mut entries| {
    entries.retain(|(key, _)| prefixes.iter().any(|prefix| key.starts_with(prefix)));
    (entries.iter().map(|(k, v)| k.len() + v.len()).sum::<usize>() <= MAX_DRAFT_BYTES).then_some(entries)
  });
  crate::desks::departure(shell, label, activation, url, entries);
}

#[cfg(target_os = "linux")]
pub fn install(window: &tauri::WebviewWindow, token: String) -> tauri::Result<()> {
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
      let Ok((_, activation, url, entries)) = serde_json::from_str::<(String, f64, String, Option<Vec<(String, String)>>)>(&message) else { return };
      if let Some(shell) = shell.upgrade() {
        receive(&shell, &label, activation, &url, entries);
      }
    });
    manager.register_script_message_handler("seismicDrafts");
  })
}

pub fn script(origin: &str, restore: Option<&Placed>, message_key: &str) -> String {
  let restore = restore.filter(|p| p.origin.as_deref() == Some(origin));
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
      function send(entries) {{
        const url = location.href;
        const payload = {{ activation, url, entries }};
        // Hand the data to the native message queue before the document goes away.
        if (usesTauri) {{
          const callback = api.transformCallback(() => {{}}, true);
          post?.(stringify({{ cmd: command, callback, error: callback, payload, __TAURI_INVOKE_KEY__: messageKey }}));
        }} else {{
          post?.(stringify([messageKey, activation, url, entries]));
        }}
      }}
      function begin() {{
        activation = performance.timeOrigin + performance.now();
        send(null);
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
        const overflow = [];
        for (const [key, value] of entries) {{
          try {{
            if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
          }} catch {{ overflow.push([key, value]); }}
        }}
        if (overflow.length) window.seismicDraftOverflow = overflow;
      }}
      if (!window.seismicDraftOverflow) {{
        window.seismicDraftsReceived = true;
        // Clean up the previous shell's departure copy after restoring the session.
        try {{ localStorage.removeItem(key); }} catch {{}}
      }}
      begin();
      addEventListener('pageshow', (event) => {{ if (event.persisted) begin(); }});
      addEventListener('pagehide', () => {{
        try {{ send(save()); }} catch {{}}
      }});
    }})();"#,
    serde_json::json!(origin),
    serde_json::json!(checkpoint),
    serde_json::json!(message_key),
    !cfg!(target_os = "linux"),
    serde_json::json!(drafts)
  )
}
