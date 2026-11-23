// What the shell asks a remote Seismic over HTTP itself, never through a webview: whether it answers
// (before a window opens on it), and a pairing with the code of its "Connect a device"
// (`POST /api/pair`, src/server/remote.ts `pairApi`), whose answer is a one-time login link for the
// window to open.

use std::time::Duration;

use serde_json::Value;
use tauri::Url;

fn agent() -> ureq::Agent {
  // no redirect: what answers at the address is what the window would show
  ureq::AgentBuilder::new()
    .redirects(0)
    .timeout_connect(Duration::from_secs(5))
    .timeout(Duration::from_secs(10))
    .build()
}

/// What answers at an origin.
#[derive(Debug, PartialEq)]
pub enum Health {
  /// Seismic: its projects, or its refusal of a device it does not know.
  Seismic,
  /// Nothing answers: no such name, no connection, a certificate the system does not trust.
  Unreachable,
  /// Something else answers: another server's page, a proxy's error, a login.
  NotSeismic,
}

impl Health {
  pub fn code(&self) -> &'static str {
    match self {
      Health::Seismic => "ok",
      Health::Unreachable => "unreachable",
      Health::NotSeismic => "notSeismic",
    }
  }
}

/// Asks `origin` for its projects, as its page does, without the window's device cookie (the shell
/// has none of its own): Seismic identifies its projects response or returns its JSON refusal (`notPaired`).
pub fn health(origin: &str) -> Health {
  let res = match agent().get(&format!("{origin}/api/projects")).set("accept", "application/json").call() {
    Ok(res) | Err(ureq::Error::Status(_, res)) => res,
    Err(_) => return Health::Unreachable,
  };
  let status = res.status();
  let projects = res.header("x-seismic").is_some_and(|value| value == "projects");
  let json = res.content_type().eq_ignore_ascii_case("application/json");
  let body = if json { res.into_json::<Value>().ok() } else { None };
  judge(status, projects, body.as_ref())
}

fn judge(status: u16, projects: bool, body: Option<&Value>) -> Health {
  match (status, body) {
    (200, Some(Value::Array(_))) if projects => Health::Seismic,
    (401, Some(b)) if b["code"].as_str() == Some("notPaired") => Health::Seismic,
    _ => Health::NotSeismic,
  }
}

/// Pairs with the Seismic at `origin` by `code`: the one-time link its window opens, at that very
/// origin; else why not, as the pages say it (`wrongCode`, `codeExpired`, `onThisMachine`,
/// `unreachable`, `notSeismic`, `invalid`).
pub fn pair(origin: &str, code: &str) -> Result<Url, &'static str> {
  let res = agent()
    .post(&format!("{origin}/api/pair"))
    .set("content-type", "application/json")
    .send_string(&serde_json::json!({ "code": code.trim() }).to_string());
  let res = match res {
    Ok(res) | Err(ureq::Error::Status(_, res)) => res,
    Err(_) => return Err("unreachable"),
  };
  let status = res.status();
  let body = if res.content_type().eq_ignore_ascii_case("application/json") {
    res.into_json::<Value>().ok()
  } else {
    None
  };
  paired(origin, status, body.as_ref())
}

fn paired(origin: &str, status: u16, body: Option<&Value>) -> Result<Url, &'static str> {
  let Some(body) = body else { return Err("notSeismic") };
  match (status, body["code"].as_str()) {
    (200, _) => {
      let url = body["url"].as_str().and_then(|u| Url::parse(u).ok()).ok_or("notSeismic")?;
      // the link leads nowhere but the window's own origin
      if !matches!(url.scheme(), "http" | "https") || url.origin().ascii_serialization() != origin {
        return Err("elsewhere");
      }
      Ok(url)
    }
    (401, Some("wrongCode")) => Err("wrongCode"),
    (410, Some("codeExpired")) => Err("codeExpired"),
    (409, Some("onThisMachine")) => Err("onThisMachine"),
    (400, Some(_)) => Err("invalid"),
    _ => Err("notSeismic"),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn seismic_answers_with_its_projects_or_its_refusal() {
    assert_eq!(judge(200, true, Some(&json!([]))), Health::Seismic);
    assert_eq!(judge(401, false, Some(&json!({ "code": "notPaired" }))), Health::Seismic);
    assert_eq!(judge(200, false, Some(&json!([]))), Health::NotSeismic);
    assert_eq!(judge(200, false, Some(&json!({ "projects": [] }))), Health::NotSeismic);
    assert_eq!(judge(200, true, None), Health::NotSeismic);
    assert_eq!(judge(401, false, Some(&json!({ "code": "loginRequired" }))), Health::NotSeismic);
    assert_eq!(judge(403, false, Some(&json!({ "code": "notPaired" }))), Health::NotSeismic);
  }

  #[test]
  fn a_pairing_answers_with_a_link_at_its_origin_or_why_not() {
    let ok = json!({ "url": "https://studio/pair?token=abc", "expires": "2026-11-23T10:00:00Z" });
    assert_eq!(paired("https://studio", 200, Some(&ok)).unwrap().as_str(), "https://studio/pair?token=abc");
    assert_eq!(paired("https://other", 200, Some(&ok)), Err("elsewhere"));
    assert_eq!(paired("https://studio", 401, Some(&json!({ "code": "wrongCode" }))), Err("wrongCode"));
    assert_eq!(paired("https://studio", 410, Some(&json!({ "code": "codeExpired" }))), Err("codeExpired"));
    assert_eq!(paired("https://studio", 409, Some(&json!({ "code": "onThisMachine" }))), Err("onThisMachine"));
    assert_eq!(paired("https://studio", 400, Some(&json!({ "code": "invalid" }))), Err("invalid"));
    assert_eq!(paired("https://studio", 200, None), Err("notSeismic"));
    assert_eq!(paired("https://studio", 200, Some(&json!({ "url": "not a url" }))), Err("notSeismic"));
  }
}
