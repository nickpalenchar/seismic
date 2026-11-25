// What the shell asks a remote Seismic over HTTP itself, never through a webview: whether it answers
// (before a window opens on it), and a pairing with the code of its "Connect a device"
// (`POST /api/pair`, src/server/remote.ts `pairApi`), whose answer is a one-time login link for the
// window to open.

use std::{io::Read, time::Duration};

use serde_json::Value;
use tauri::Url;

const HEALTH_LIMIT: u64 = 4 * 1024;
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
  /// Seismic: its health answer, or its refusal of a device it does not know.
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

fn get(origin: &str, path: &str) -> Result<ureq::Response, Health> {
  match agent().get(&format!("{origin}{path}")).set("accept", "application/json").call() {
    Ok(res) | Err(ureq::Error::Status(_, res)) => Ok(res),
    Err(_) => Err(Health::Unreachable),
  }
}

/// Asks `origin` whether Seismic answers there (`GET /api/v1/health`), without the window's device
/// cookie (the shell has none of its own): Seismic names itself in a few bytes, however large its
/// workspace, or returns its JSON refusal (`notPaired`). A Seismic from before that route does not
/// know it (a 404, or its "Not connected" page to a device it does not know) and is asked for its
/// projects instead.
pub fn health(origin: &str) -> Health {
  let res = match get(origin, "/api/v1/health") {
    Ok(res) => res,
    Err(problem) => return problem,
  };
  let status = res.status();
  let body = matches!(status, 200 | 401).then(|| response_json(res, HEALTH_LIMIT)).flatten();
  // A Seismic health reply that reports a non-OK state must not be overridden by
  // a successful projects response from the same origin.
  if status == 200 && body.as_ref().is_some_and(|b| b["service"].as_str() == Some("seismic")) {
    return judge(status, body.as_ref());
  }
  match judge(status, body.as_ref()) {
    Health::Seismic => Health::Seismic,
    _ => earlier_health(origin),
  }
}

/// A Seismic from before `/api/v1/health` marks its projects response (`X-Seismic: projects`); the
/// list itself goes unread, as long as it may be.
fn earlier_health(origin: &str) -> Health {
  let res = match get(origin, "/api/projects") {
    Ok(res) => res,
    Err(problem) => return problem,
  };
  let status = res.status();
  if status == 200 && res.header("x-seismic") == Some("projects") && res.content_type().eq_ignore_ascii_case("application/json") {
    return Health::Seismic;
  }
  let body = (status == 401).then(|| response_json(res, PAIR_LIMIT)).flatten();
  judge(status, body.as_ref())
}

fn judge(status: u16, body: Option<&Value>) -> Health {
  match (status, body) {
    (200, Some(b)) if b["service"].as_str() == Some("seismic") && b["status"].as_str() == Some("ok") => Health::Seismic,
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
  use std::{io::{self, BufRead, BufReader, Write}, net::TcpListener, ops::Deref, sync::mpsc, thread::JoinHandle};

  struct TestServer {
    origin: String,
    shutdown: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
  }

  impl Deref for TestServer {
    type Target = str;
    fn deref(&self) -> &str { &self.origin }
  }

  impl Drop for TestServer {
    fn drop(&mut self) {
      let _ = self.shutdown.send(());
      self.thread.take().unwrap().join().unwrap();
    }
  }

  /// A server answering each path it is given with its status line (and headers) and body, as long
  /// as the test runs; any other path gets a plain 404, as Bun's does for an unknown route.
  fn serve(routes: Vec<(&str, &str, String)>) -> TestServer {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let routes: Vec<(String, String, String)> = routes.into_iter().map(|(p, h, b)| (p.into(), h.into(), b.replace("{origin}", &origin))).collect();
    let (shutdown, stopped) = mpsc::channel();
    let thread = std::thread::spawn(move || {
      loop {
        let stream = match listener.accept() {
          Ok((stream, _)) => stream,
          Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            match stopped.recv_timeout(Duration::from_millis(10)) {
              Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
              Err(mpsc::RecvTimeoutError::Timeout) => continue,
            }
          }
          Err(error) => panic!("test server accept failed: {error}"),
        };
        stream.set_nonblocking(false).unwrap();
        let mut stream = BufReader::new(stream);
        let mut line = String::new();
        if stream.read_line(&mut line).is_err() {
          continue;
        }
        let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
        let mut length = 0;
        line.clear();
        while stream.read_line(&mut line).unwrap_or(0) != 0 && !line.trim().is_empty() {
          if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
              length = value.trim().parse().unwrap();
            }
          }
          line.clear();
        }
        // Pairing is a POST. Closing while request bytes are unread can reset the connection
        // instead of letting the client read the oversized response.
        let _ = io::copy(&mut stream.by_ref().take(length), &mut io::sink());
        let Some((_, header, body)) = routes.iter().find(|(p, _, _)| *p == path) else {
          let _ = write!(stream.get_mut(), "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot found");
          continue;
        };
        // A chunked response does not advertise its size. The client can stop as soon as it hits its limit.
        let header = if header.contains("Content-Type") { header.clone() } else { format!("{header}\r\nContent-Type: application/json") };
        let _ = write!(stream.get_mut(), "HTTP/1.1 {header}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n", body.len());
      }
    });
    TestServer { origin, shutdown, thread: Some(thread) }
  }

  const HEALTHY: &str = r#"{"service":"seismic","status":"ok"}"#;
  const NOT_PAIRED: &str = r#"{"code":"notPaired","error":"this device is not paired with Seismic"}"#;

  /// A project list well beyond any limit the shell reads to.
  fn many_projects() -> String {
    let project = r#"{"id":"web","name":"Web","waiting":0},"#;
    format!("[{}{{}}]", project.repeat(4 * 1024 * 1024 / project.len()))
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
  fn a_large_workspace_answers_on_opening_and_on_retrying() {
    let studio = serve(vec![("/api/v1/health", "200 OK", HEALTHY.into()), ("/api/projects", "200 OK\r\nX-Seismic: projects", many_projects())]);
    assert_eq!(health(&studio), Health::Seismic);
    assert_eq!(health(&studio), Health::Seismic);
  }

  #[test]
  fn a_reported_unhealthy_state_cannot_be_overridden_by_projects_or_pairing() {
    for body in [r#"{"service":"seismic"}"#, r#"{"service":"seismic","status":"down"}"#] {
      let studio = serve(vec![
        ("/api/v1/health", "200 OK", body.into()),
        ("/api/projects", "200 OK\r\nX-Seismic: projects", "[]".into()),
        ("/api/pair", "200 OK", r#"{"url":"{origin}/pair?token=abc"}"#.into()),
      ]);
      assert_eq!(health(&studio), Health::NotSeismic);
      assert_eq!(pair(&studio, "123456"), Err("notSeismic"));
    }
  }

  #[test]
  fn the_test_server_releases_its_listener_on_drop() {
    let studio = serve(vec![]);
    let address = studio.origin.trim_start_matches("http://").to_string();
    drop(studio);
    assert!(TcpListener::bind(address).is_ok());
  }

  #[test]
  fn a_signed_out_seismic_answers_with_its_refusal() {
    let studio = serve(vec![("/api/v1/health", "401 Unauthorized", NOT_PAIRED.into()), ("/api/projects", "401 Unauthorized", NOT_PAIRED.into())]);
    assert_eq!(health(&studio), Health::Seismic);
    let login = serve(vec![("/api/v1/health", "401 Unauthorized", r#"{"code":"loginRequired"}"#.into())]);
    assert_eq!(health(&login), Health::NotSeismic);
  }

  #[test]
  fn a_seismic_from_before_the_health_route_answers_with_its_marked_projects() {
    let large = serve(vec![("/api/projects", "200 OK\r\nX-Seismic: projects", many_projects())]);
    assert_eq!(health(&large), Health::Seismic);
    assert_eq!(health(&large), Health::Seismic);
    // to a device it does not know, it answers the unknown route with its "Not connected" page
    let page = "401 Unauthorized\r\nContent-Type: text/html; charset=utf-8";
    let signed_out = serve(vec![("/api/v1/health", page, "<!doctype html><title>Not connected</title>".into()), ("/api/projects", "401 Unauthorized", NOT_PAIRED.into())]);
    assert_eq!(health(&signed_out), Health::Seismic);
    assert_eq!(health(&signed_out), Health::Seismic);
  }

  #[test]
  fn another_service_is_not_seismic() {
    assert_eq!(health(&serve(vec![])), Health::NotSeismic);
    assert_eq!(health(&serve(vec![("/api/projects", "200 OK", "[]".into())])), Health::NotSeismic);
    assert_eq!(health(&serve(vec![("/api/v1/health", "200 OK", r#"{"status":"ok"}"#.into())])), Health::NotSeismic);
    assert_eq!(health(&serve(vec![("/api/v1/health", "200 OK", r#"{"service":"other","status":"ok"}"#.into())])), Health::NotSeismic);
    assert_eq!(health(&serve(vec![("/api/v1/health", "403 Forbidden", NOT_PAIRED.into())])), Health::NotSeismic);
    // the earlier check stays as strict: an unmarked list or another refusal is no Seismic either
    assert_eq!(health(&serve(vec![("/api/v1/health", "500 Internal Server Error", "{}".into()), ("/api/projects", "200 OK", "[]".into())])), Health::NotSeismic);
    assert_eq!(health(&serve(vec![("/api/projects", "401 Unauthorized", r#"{"code":"loginRequired"}"#.into())])), Health::NotSeismic);
  }

  #[test]
  fn marked_non_json_projects_cannot_authorize_a_workspace_or_pairing() {
    for content_type in ["text/html; charset=utf-8", "text/plain"] {
      let marked = format!("200 OK\r\nX-Seismic: projects\r\nContent-Type: {content_type}");
      let studio = serve(vec![("/api/projects", &marked, "<!doctype html><title>Sign in</title>".into())]);
      assert_eq!(health(&studio), Health::NotSeismic);
    }
    let studio = serve(vec![
      ("/api/projects", "200 OK\r\nX-Seismic: projects\r\nContent-Type: text/html", "<!doctype html><title>Sign in</title>".into()),
      ("/api/pair", "200 OK", r#"{"url":"{origin}/pair?token=abc"}"#.into()),
    ]);
    assert_eq!(pair(&studio, "123456"), Err("notSeismic"));
  }

  #[test]
  fn oversized_health_and_pairing_responses_use_the_normal_error_paths() {
    let healthy = serve(vec![("/api/v1/health", "200 OK", format!("{HEALTHY}{}", " ".repeat(HEALTH_LIMIT as usize)))]);
    assert_eq!(health(&healthy), Health::NotSeismic);
    let refused = serve(vec![("/api/v1/health", "401 Unauthorized", format!("{NOT_PAIRED}{}", " ".repeat(HEALTH_LIMIT as usize)))]);
    assert_eq!(health(&refused), Health::NotSeismic);
    let earlier = serve(vec![("/api/projects", "401 Unauthorized", format!("{NOT_PAIRED}{}", " ".repeat(PAIR_LIMIT as usize)))]);
    assert_eq!(health(&earlier), Health::NotSeismic);
    let pairing = serve(vec![("/api/pair", "401 Unauthorized", format!(r#"{{"code":"wrongCode"}}{}"#, " ".repeat(PAIR_LIMIT as usize)))]);
    assert_eq!(pair(&pairing, "123456"), Err("notSeismic"));
  }

  #[test]
  fn seismic_answers_with_its_name_or_its_refusal() {
    assert_eq!(judge(200, Some(&json!({ "service": "seismic", "status": "ok" }))), Health::Seismic);
    assert_eq!(judge(200, Some(&json!({ "service": "seismic" }))), Health::NotSeismic);
    assert_eq!(judge(200, Some(&json!({ "service": "seismic", "status": "down" }))), Health::NotSeismic);
    assert_eq!(judge(401, Some(&json!({ "code": "notPaired" }))), Health::Seismic);
    assert_eq!(judge(200, Some(&json!([]))), Health::NotSeismic);
    assert_eq!(judge(200, None), Health::NotSeismic);
    assert_eq!(judge(401, Some(&json!({ "service": "seismic" }))), Health::NotSeismic);
    assert_eq!(judge(401, Some(&json!({ "code": "loginRequired" }))), Health::NotSeismic);
    assert_eq!(judge(403, Some(&json!({ "code": "notPaired" }))), Health::NotSeismic);
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
