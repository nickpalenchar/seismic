// Workspace capture runs off the UI thread. Ask the visible document before hiding it,
// then recheck with input hidden so an upload begun in between also gets a decision.
use std::{sync::mpsc, thread, time::Duration};
use tauri::{AppHandle, Webview};

use super::{CaptureHold, Shell};

struct Decision {
  view: Webview,
  id: uuid::Uuid,
  release: bool,
}

impl Decision {
  fn new(view: &Webview) -> Self {
    Self { view: view.clone(), id: uuid::Uuid::new_v4(), release: true }
  }

  fn script(&self, action: &str) -> String {
    format!(r#"window.seismicAttachmentSwitch?.("{}", "{action}") ?? "ready""#, self.id)
  }

  fn ready(&self, action: &str) -> Result<bool, String> {
    let (send, receive) = mpsc::channel();
    self.view.eval_with_callback(self.script(action), move |value| { let _ = send.send(value); }).map_err(|_| "drafts")?;
    match receive.recv_timeout(Duration::from_secs(2)).as_deref() {
      Ok(r#""ready""#) => Ok(true),
      Ok(r#""pending""#) => Ok(false),
      Ok(r#""back""#) => Err("cancelled".into()),
      _ => Err("drafts".into()),
    }
  }
}

impl Drop for Decision {
  fn drop(&mut self) {
    if self.release {
      let _ = self.view.eval(self.script("end"));
    }
  }
}

pub(super) struct Hold {
  _input: CaptureHold,
  decision: Decision,
}

impl Hold {
  /// Navigation has been queued or the old view is being retired. Its queued page
  /// reload must not run while the native navigation is still on its way.
  pub(super) fn navigating(&mut self) {
    self.decision.release = false;
  }

  /// A same-webview navigation can fail before replacing its document. Give it
  /// time to start, then release this decision even if the old document remains.
  pub(super) fn awaiting_navigation(self) {
    let Self { _input, decision, .. } = self;
    drop(_input);
    thread::spawn(move || {
      thread::sleep(super::LOAD_PATIENCE);
      drop(decision);
    });
  }
}

#[derive(Clone, Copy)]
pub(super) enum OnBack {
  Cancel,
  Wait,
}

pub(super) fn hold(app: &AppHandle, shell: &Shell, view: &Webview, turn: u64, on_back: OnBack) -> Result<Hold, String> {
  hold_after(app, shell, view, turn, on_back, false, |_| Ok(())).map(|(hold, ())| hold)
}

pub(super) fn hold_after<T>(
  app: &AppHandle, shell: &Shell, view: &Webview, turn: u64, on_back: OnBack, connecting: bool,
  mut prepare: impl FnMut(bool) -> Result<T, String>,
) -> Result<(Hold, T), String> {
  let mut decision = Decision::new(view);
  let mut action = "ask";
  let mut waited = false;
  let current = || {
    let views = shell.views.lock().unwrap();
    !crate::is_stopping(app) && views.turn == turn && views.label() == view.label()
  };
  loop {
    let asking = shell.attachment_decision.lock().unwrap();
    if !current() {
      return Err("superseded".into());
    }
    let ready: Result<Option<(CaptureHold, T)>, String> = (|| {
      if !decision.ready(action)? {
        return Ok(None);
      }
      if (connecting || waited && matches!(on_back, OnBack::Cancel)) && !decision.ready("connecting")? {
        return Ok(None);
      }
      // Keep the document visible while the destination answers. The page
      // claim still blocks reconnect reloads, and a newer selection can proceed.
      drop(asking);
      let prepared = prepare(waited)?;
      let _asking = shell.attachment_decision.lock().unwrap();
      if !current() {
        return Err("superseded".into());
      }
      let input = CaptureHold::acquire(app, view.label().to_string())?;
      Ok(decision.ready("check")?.then_some((input, prepared)))
    })();
    match ready {
      Ok(Some((input, prepared))) => return Ok((Hold { _input: input, decision }, prepared)),
      Ok(None) => waited = true,
      Err(error) if error == "cancelled" && matches!(on_back, OnBack::Wait) => {
        // A replacement local server still needs attaching. End the dismissed prompt
        // and start checking for idle uploads without opening another dialog.
        let quiet = Decision::new(view);
        quiet.ready("check")?;
        decision = quiet;
        action = "check";
      }
      Err(error) => return Err(error),
    }
    thread::sleep(Duration::from_millis(150));
  }
}
