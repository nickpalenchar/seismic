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
}

impl Drop for Decision<'_> {
  fn drop(&mut self) {
    let _ = self.view.eval(self.script("end"));
  }
}

pub(super) fn hold(app: &AppHandle, shell: &Shell, view: &Webview, turn: u64) -> Result<CaptureHold, String> {
  let _asking = shell.attachment_decision.lock().unwrap();
  let decision = Decision { view, id: uuid::Uuid::new_v4() };
  loop {
    {
      let views = shell.views.lock().unwrap();
      if views.turn != turn || views.label() != view.label() {
        return Err("superseded".into());
      }
    }
    if decision.ready("ask")? {
      let hold = CaptureHold::acquire(app, view.label().to_string())?;
      if decision.ready("check")? {
        return Ok(hold);
      }
    }
    thread::sleep(Duration::from_millis(150));
  }
}
