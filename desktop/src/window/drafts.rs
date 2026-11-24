use uuid::Uuid;

use super::placed::Placed;

// Shared by restart sampling and the workspace's departure snapshot. Session storage also contains
// temporary UI state and pairing setup; only unsent work belongs in a durable copy.
pub const SESSION_DRAFTS: &str = r#"(entries = window.seismicSnapshotSession?.() ?? Object.entries(sessionStorage)) =>
  entries.filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' &&
    /^seismic-(drafts|markups|setting-draft|kept|wish|config-draft)-/.test(entry[0]))"#;

pub fn script(origin: &str, checkpoint: Uuid, restore: Option<&Placed>) -> String {
  let restore = restore.filter(|p| p.origin.as_deref() == Some(origin));
  let restore_departed = restore.is_some_and(|p| p.draft_checkpoint == Some(checkpoint));
  let drafts = restore.map(|p| p.drafts.as_slice()).unwrap_or_default();
  format!(
    r#"(() => {{
      if (window.top !== window || location.origin !== {}) return;
      const key = 'seismic-desktop-departed-drafts';
      const windowId = '{}';
      const save = {SESSION_DRAFTS};
      const received = 'seismic-desktop-restored';
      let entries = {};
      if ({restore_departed}) try {{
        // A status document cannot read the workspace's storage. Only the next window restored
        // from this placement can use the origin's departure copy.
        const checkpoint = JSON.parse(localStorage.getItem(key));
        if (checkpoint?.windowId === windowId && Array.isArray(checkpoint.entries)) entries = save(checkpoint.entries);
      }} catch {{}}
      try {{
        window.seismicRestoredDrafts = new Set(entries.map(([key]) => key));
        if (!sessionStorage.getItem(received)) {{
          for (const [key, value] of entries) {{
            if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
          }}
          sessionStorage.setItem(received, '1');
        }}
        // Resume from the actual session after Back/Forward too. A fresh window at this origin
        // discards a copy left by a closed window, whose identifier it cannot inherit.
        const clear = () => {{ try {{ localStorage.removeItem(key); }} catch {{}} }};
        clear();
        addEventListener('pageshow', (event) => {{ if (event.persisted) clear(); }});
      }} catch {{}}
      addEventListener('pagehide', () => {{
        // This write is synchronous even when the workspace is offline or the document is leaving.
        try {{ localStorage.setItem(key, JSON.stringify({{ windowId, entries: save() }})); }} catch {{}}
      }});
    }})();"#,
    serde_json::json!(origin),
    checkpoint,
    serde_json::json!(drafts)
  )
}
