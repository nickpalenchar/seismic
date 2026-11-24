// What the shell asks a remote Seismic over HTTP itself, never through a webview: whether it answers
// (before a window opens on it), and a pairing with the code of its "Connect a device"
// (`POST /api/pair`, src/server/remote.ts `pairApi`), whose answer is a one-time login link for the
// window to open.

use std::{io::Read, time::Duration};

use serde_json::Value;
use tauri::Url;

const PROJECTS_LIMIT: u64 = 1024 * 1024;
const PAIR_LIMIT: u64 = 16 * 1024;

fn bounded_json(reader: impl Read, limit: u64) -> Option<Value> {
  let mut bytes = Vec::new();
  reader.take(limit + 1).read_to_end(&mut bytes).ok()?;
  if bytes.len() as u64 > limit {
    return None;
  }
  serde_json::from_slice(&bytes).ok()
}

fn response_json(response: ureq::Response, limit: u64) -> Option<Value> {
  response.content_type().eq_ignore_ascii_case("application/json").then_some(())?;
  bounded_json(response.into_reader(), limit)
}

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
  let body = match (status, projects) {
    (200, true) => response_json(res, PROJECTS_LIMIT),
    (401, _) => response_json(res, PAIR_LIMIT),
    _ => None,
  };
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
  let body = response_json(res, PAIR_LIMIT);
  let link = paired(origin, status, body.as_ref())?;
  // A same-origin URL in the pairing response is not proof that the origin
  // serves Seismic. Verify it before saving or granting a workspace webview.
  match health(origin) {
    Health::Seismic => Ok(link),
    problem => Err(problem.code()),
  }
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
  use std::{io::{self, BufRead, BufReader, Write}, net::TcpListener};

  fn reply(header: &str, body: String) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let header = header.to_string();
    std::thread::spawn(move || {
      let (stream, _) = listener.accept().unwrap();
      let mut stream = BufReader::new(stream);
      let mut line = String::new();
      let mut length = 0;
      while stream.read_line(&mut line).unwrap() != 0 && !line.trim().is_empty() {
        if let Some((name, value)) = line.split_once(':') {
          if name.eq_ignore_ascii_case("content-length") {
            length = value.trim().parse().unwrap();
          }
        }
        line.clear();
      }
      // Pairing is a POST. Closing while request bytes are unread can reset the connection
      // instead of letting the client read the oversized response.
      io::copy(&mut stream.by_ref().take(length), &mut io::sink()).unwrap();
      // A chunked response does not advertise its size. The client can stop as soon as it hits its limit.
      let _ = write!(stream.get_mut(), "HTTP/1.1 {header}\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n", body.len());
    });
    origin
  }

  #[test]
  fn decoding_checks_the_entire_body_even_after_valid_json() {
    assert_eq!(bounded_json(&b"[]  "[..], 4), Some(json!([])));
    assert_eq!(bounded_json(&b"[]   "[..], 4), None);
    let mut endless = std::io::repeat(b' ');
    let mut body = (&b"[]"[..]).chain(&mut endless);
    assert_eq!(bounded_json(&mut body, 4), None);
    assert_eq!(bounded_json(&b"[broken"[..], 16), None);
  }

  #[test]
  fn oversized_health_and_pairing_responses_use_the_normal_error_paths() {
    let projects = reply("200 OK\r\nX-Seismic: projects", format!("[]{}", " ".repeat(PROJECTS_LIMIT as usize)));
    assert_eq!(health(&projects), Health::NotSeismic);
    let refused = reply("401 Unauthorized", format!(r#"{{"code":"notPaired"}}{}"#, " ".repeat(PAIR_LIMIT as usize)));
    assert_eq!(health(&refused), Health::NotSeismic);
    let pairing = reply("401 Unauthorized", format!(r#"{{"code":"wrongCode"}}{}"#, " ".repeat(PAIR_LIMIT as usize)));
    assert_eq!(pair(&pairing, "123456"), Err("notSeismic"));
  }

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
