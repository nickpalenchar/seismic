// Workspace capture runs off the UI thread. Ask the visible document before hiding it,
// then recheck with input hidden so an upload begun in between also gets a decision.
use std::{sync::mpsc, thread, time::Duration};
use tauri::{AppHandle, Webview};

use super::{CaptureHold, Shell};

struct Decision<'a> {
  view: &'a Webview,
  id: uuid::Uuid,
}

impl Decision<'_> {
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

  fn hold_when_ready(&self, app: &AppHandle, action: &str) -> Result<Option<CaptureHold>, String> {
    if !self.ready(action)? {
      return Ok(None);
    }
    let hold = CaptureHold::acquire(app, self.view.label().to_string())?;
    Ok(self.ready("check")?.then_some(hold))
  }
}

impl Drop for Decision<'_> {
  fn drop(&mut self) {
    let _ = self.view.eval(self.script("end"));
  }
}

#[derive(Clone, Copy)]
pub(super) enum OnBack {
  Cancel,
  Wait,
}

pub(super) fn hold(app: &AppHandle, shell: &Shell, view: &Webview, turn: u64, on_back: OnBack) -> Result<CaptureHold, String> {
  let _asking = shell.attachment_decision.lock().unwrap();
  let mut decision = Decision { view, id: uuid::Uuid::new_v4() };
  let mut action = "ask";
  loop {
    if crate::is_stopping(app) {
      return Err("superseded".into());
    }
    {
      let views = shell.views.lock().unwrap();
      if views.turn != turn || views.label() != view.label() {
        return Err("superseded".into());
      }
    }
    match decision.hold_when_ready(app, action) {
      Ok(Some(hold)) => return Ok(hold),
      Ok(None) => {}
      Err(error) if error == "cancelled" && matches!(on_back, OnBack::Wait) => {
        // A replacement local server still needs attaching. End the dismissed prompt
        // and start checking for idle uploads without opening another dialog.
        decision = Decision { view, id: uuid::Uuid::new_v4() };
        action = "check";
      }
      Err(error) => return Err(error),
    }
    thread::sleep(Duration::from_millis(150));
  }
}
