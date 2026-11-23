// Seismic as an app: a window on the project of the compiled server (`seismic-server`, a sidecar beside
// this program, built by scripts/build-app.ts), which the shell starts and stops.
//
// - One Seismic per home: when one runs on the home already ($SEISMIC_HOME/server.json, written by the
//   server), the window opens on it instead of starting a second. Whoever started it (the app, or
//   `bun start` in a terminal), it stops when the app quits, and the app ends when it does.
// - The server picks no port of its own: 4417 ($SEISMIC_PORT) when free, else one the system hands out.
// - Quitting stops the server through `POST /api/stop`, the way Ctrl-C does: workers in the middle
//   of a turn pause first (at most 15 minutes), and the window shows that until the server is gone.
//   Quitting again goes ahead at once. No signal: Windows has no SIGTERM, and a killed server would
//   cut its workers off mid-turn. The app ends when the server does.
// - Single instance: starting the app again brings its window to the front.
// - Every request to the server names the owner's key from the home (`owner.key`,
//   src/server/owner.ts); the window signs in through a link the shell asks the server for
//   (`POST /api/login-link`).
// - Links to anything but the project, and new windows, open in the default browser; so does
//   "Open in Browser" (the page offers it when it finds `window.seismicApp`, the macOS menu too),
//   through a link that signs that one browser in.
// - The page gets the microphone without asking (it records only while Space or the mic button is
//   held); the system asks once for the app. WebKitGTK has media streams off until turned on here.
// - Downloads go into the Downloads folder and are shown there.
// - A newer release is downloaded in the background, shown in the bar and installed when the owner
//   says so, once the workers paused (update.rs).
// - SEISMIC_APP_CHECK=<url of a module>: each window's page imports it once it has loaded (window/)
//   (scripts/check-app.ts checks the microphone and video in the webview that way).
// - SEISMIC_CHECKOUT=<checkout>: started from a checkout (`bun run app`, scripts/app.ts), the shell
//   starts `bun <checkout>/src/server/main.ts` (SEISMIC_BUN names the bun) instead of the sidecar,
//   which then updates itself from its checkout as `bun start` does. Installed from a checkout
//   (`bun run app install`), the shell has both compiled in (SEISMIC_BUILT_CHECKOUT, SEISMIC_BUILT_BUN),
//   and builds itself anew when desktop/ changes there (update.rs).
// - Starting again (an update, a new build) brings the windows back where they were, on the pages they
//   showed (`relaunch`, window/placed.rs).
// - Remote workspaces (docs/plan/remote-workspaces.md): one window each, on its one origin, beside this
//   machine's (`main`); the list, the pairing and the commands their pages call are in desks/, the
//   windows and what keeps each on its origin in window/, the macOS menu in menu.rs.
// - On a Mac an Seismic that runs without the app that started it lacks the system's permissions for
//   that app (the local network): the shell has it end once its workers paused and starts it again
//   under itself (`orphaned`).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desks;
mod menu;
mod update;
mod window;

use std::{
  fs,
  io::{Read, Write},
  net::{SocketAddr, TcpListener, TcpStream},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::{
    atomic::{AtomicBool, AtomicU16, Ordering},
    Arc, Mutex, OnceLock,
  },
  thread,
  time::{Duration, Instant},
};

use tauri::{AppHandle, DragDropEvent, Manager, PhysicalPosition, RunEvent, Url, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use window::{placed, Own};

const SERVER: &str = if cfg!(windows) { "seismic-server.exe" } else { "seismic-server" };
const DEFAULT_PORT: u16 = 4417;
/// How long the server may take to answer after it was started.
const START_PATIENCE: Duration = Duration::from_secs(120);
const KEY_HEADER: &str = "X-Seismic-Key";

/// Seismic's home, once known.
static HOME: OnceLock<PathBuf> = OnceLock::new();

/// The owner's key in the home, which the server makes when it first starts.
fn key() -> Option<String> {
  let key = fs::read_to_string(HOME.get()?.join("owner.key")).ok()?;
  Some(key.trim().to_string()).filter(|k| !k.is_empty())
}

/// A link that signs a browser or webview in and opens `next`; `once`: for one browser, as one that
/// goes through the system's `open` is seen by other accounts in the process list. The plain address
/// from an Seismic that has no such link.
pub(crate) fn login_link(port: u16, next: &str, once: bool) -> String {
  post(port, "/api/login-link", &serde_json::json!({ "next": next, "once": once }))
    .and_then(|v| v["url"].as_str().map(String::from))
    .unwrap_or_else(|| format!("http://127.0.0.1:{port}{next}"))
}

/// What the shell knows of the Seismic its window shows.
#[derive(Default)]
pub(crate) struct Seismic {
  /// Where it answers; 0 until known.
  pub(crate) port: AtomicU16,
  /// Started in this run: the shell sees it end, and how (an update is installed then).
  pub(crate) child: AtomicBool,
  /// The owner quit; the server is told once it answers.
  pub(crate) stopping: AtomicBool,
  /// The shell starts again (`relaunch`): leaving, it does not stop the server.
  relaunching: AtomicBool,
  /// Where the window opens: the page it showed before the shell started again, else the project.
  first: Mutex<Option<String>>,
}

pub(crate) fn local_origin(port: u16) -> String {
  if port == 80 {
    "http://127.0.0.1".into()
  } else {
    format!("http://127.0.0.1:{port}")
  }
}

/// An environment variable of Seismic by its name without the prefix: `SEISMIC_<name>`, else the
/// name from before the rename, `OBEYA_<name>`.
pub(crate) fn seismic_env(name: &str) -> Option<std::ffi::OsString> {
  std::env::var_os(format!("SEISMIC_{name}")).or_else(|| std::env::var_os(format!("OBEYA_{name}")))
}

/// The checkout whose server the shell starts, when it runs from one rather than with its sidecar.
pub(crate) fn checkout() -> Option<PathBuf> {
  seismic_env("CHECKOUT")
    .map(PathBuf::from)
    .or_else(|| option_env!("SEISMIC_BUILT_CHECKOUT").or(option_env!("OBEYA_BUILT_CHECKOUT")).filter(|c| !c.is_empty()).map(PathBuf::from))
}

/// The bun that runs the checkout's server: the one named, else the one it was built with while
/// that is there, else whichever the PATH has.
pub(crate) fn bun() -> std::ffi::OsString {
  seismic_env("BUN")
    .or_else(|| option_env!("SEISMIC_BUILT_BUN").or(option_env!("OBEYA_BUILT_BUN")).filter(|b| Path::new(b).exists()).map(Into::into))
    .unwrap_or_else(|| "bun".into())
}

/// A request to the server; its status code, or none when it does not answer.
fn http(port: u16, method: &str, path: &str) -> Option<u16> {
  let addr = SocketAddr::from(([127, 0, 0, 1], port));
  let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()?;
  s.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
  let key = key().map(|k| format!("{KEY_HEADER}: {k}\r\n")).unwrap_or_default();
  write!(
    s,
    "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{key}Content-Length: 0\r\nConnection: close\r\n\r\n"
  )
  .ok()?;
  let mut head = [0u8; 12];
  s.read_exact(&mut head).ok()?;
  std::str::from_utf8(&head[9..12]).ok()?.parse().ok()
}

/// A JSON request to the server that names the owner's key; its answer, or none when it fails.
pub(crate) fn post(port: u16, path: &str, body: &serde_json::Value) -> Option<serde_json::Value> {
  let req = ureq::post(&format!("http://127.0.0.1:{port}{path}")).timeout(Duration::from_secs(2));
  let req = match key() {
    Some(key) => req.set(KEY_HEADER, &key),
    None => req,
  };
  let res = req.set("content-type", "application/json").send_string(&body.to_string()).ok()?;
  Some(serde_json::from_str(&res.into_string().ok()?).unwrap_or(serde_json::Value::Null))
}

fn answers(port: u16) -> bool {
  http(port, "GET", "/api/projects") == Some(200)
}

pub(crate) fn home() -> PathBuf {
  seismic_env("HOME").map(PathBuf::from).unwrap_or_else(|| {
    // the default home moved from ~/.obeya to ~/.seismic (src/server/home-move.ts), by the server's
    // first start after the rename: until then the old one is the home, so that nothing (the log, the
    // window's place) makes ~/.seismic before the server moves ~/.obeya there; its symlink then leads on
    let user = std::env::home_dir().unwrap_or_default();
    let (new, old) = (user.join(".seismic"), user.join(".obeya"));
    if !new.exists() && old.is_dir() { old } else { new }
  })
}

/// The home's entry of the Seismic that runs on it (src/server/instance.ts).
fn entry(home: &Path) -> Option<serde_json::Value> {
  serde_json::from_str(&fs::read_to_string(home.join("server.json")).ok()?).ok()
}

/// The port of the Seismic that runs on `home`.
fn running(home: &Path) -> Option<u16> {
  let port = u16::try_from(entry(home)?["port"].as_u64()?).ok()?;
  answers(port).then_some(port)
}

/// Whether the Seismic that runs on `home` runs without the app that started it. On a Mac the system
/// grants its permissions (the local network, the microphone) to the app a process counts as part
/// of: the one that started it, or started what started it. Once that app has ended (it crashed, or
/// was killed) the server counts as its own, or as the ended one's, and every LAN connection of its
/// workers fails with "No route to host". Only a server an app started (`app` in its entry) counts:
/// one started from a terminal, over SSH or by launchd runs as its owner meant it to.
#[cfg(target_os = "macos")]
fn orphaned(home: &Path) -> bool {
  extern "C" {
    fn responsibility_get_pid_responsible_for_pid(pid: i32) -> i32;
    fn kill(pid: i32, sig: i32) -> i32;
  }
  const ESRCH: i32 = 3;
  let Some(entry) = entry(home).filter(|e| e["app"] == true) else { return false };
  let Some(pid) = entry["pid"].as_i64().and_then(|p| i32::try_from(p).ok()) else { return false };
  // SAFETY: both take a pid and touch nothing else; signal 0 only asks whether the process is there
  let responsible = unsafe { responsibility_get_pid_responsible_for_pid(pid) };
  responsible > 0 && (responsible == pid || (unsafe { kill(responsible, 0) } != 0 && std::io::Error::last_os_error().raw_os_error() == Some(ESRCH)))
}

#[cfg(not(target_os = "macos"))]
fn orphaned(_: &Path) -> bool {
  false
}

fn pick_port() -> u16 {
  let want = seismic_env("PORT").and_then(|p| p.into_string().ok()).and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT);
  if TcpListener::bind(("127.0.0.1", want)).is_ok() {
    return want;
  }
  TcpListener::bind(("127.0.0.1", 0))
    .and_then(|l| l.local_addr())
    .map(|a| a.port())
    .unwrap_or(want)
}

/// Files dragged over the window: the webview hands them to the app rather than the page (so the app
/// learns their paths, which a page never does), and the app passes on to the page where the drag is
/// and, at the drop, the paths (src/ui/appDrop.ts).
fn dragged(w: &WebviewWindow, drag: &DragDropEvent) {
  // where, in the page's CSS pixels: Windows gives the window's own pixels, macOS and Linux points already
  let at = |p: &PhysicalPosition<f64>| {
    let scale = if cfg!(windows) { w.scale_factor().unwrap_or(1.0) } else { 1.0 };
    (p.x / scale, p.y / scale)
  };
  let js = match drag {
    DragDropEvent::Enter { position, .. } | DragDropEvent::Over { position } => {
      let (x, y) = at(position);
      format!("window.seismicDrag?.('over', {x}, {y})")
    }
    DragDropEvent::Drop { paths, position } => {
      let (x, y) = at(position);
      let paths: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
      format!("window.seismicDrag?.('drop', {x}, {y}, {})", serde_json::to_string(&paths).unwrap_or_else(|_| "[]".into()))
    }
    DragDropEvent::Leave => "window.seismicDrag?.('leave', 0, 0)".into(),
    _ => return,
  };
  let _ = w.eval(js);
}

pub(crate) fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
  let shell = app.try_state::<Arc<desks::Shell>>()?;
  app.get_webview_window(&shell.local().0)
}

fn show(app: &AppHandle) {
  if let Some(w) = main_window(app) {
    desks::show(&w);
  }
}

/// A page of Seismic's in the system's browser, signed in there through a link of its own; another link as `open_in_browser`.
pub(crate) fn open_outside(port: Option<u16>, url: &Url) {
  let Some(port) = port.filter(|p| Own::Local(Some(*p)).at(url)) else {
    return open_in_browser(url.as_str());
  };
  let next = next_of(url);
  // off the main thread: it asks the server first
  thread::spawn(move || open_in_browser(&login_link(port, &next, true)));
}

/// Where `url` leads within Seismic, for a link that signs in and leads there.
pub(crate) fn next_of(url: &Url) -> String {
  match (url.query(), url.fragment()) {
    (Some(q), Some(f)) => format!("{}?{q}#{f}", url.path()),
    (Some(q), None) => format!("{}?{q}", url.path()),
    (None, Some(f)) => format!("{}#{f}", url.path()),
    (None, None) => url.path().to_string(),
  }
}

/// A link out of Seismic, in the system's browser. Other schemes stay closed: the system would hand
/// `file:`, `smb:` or an app's own scheme to whatever program claims it, and a worker's page may link anywhere.
pub(crate) fn open_in_browser(url: &str) {
  let scheme = url.split(':').next().unwrap_or("").to_ascii_lowercase();
  if matches!(scheme.as_str(), "http" | "https" | "mailto") {
    let _ = tauri_plugin_opener::open_url(url, None::<&str>);
  }
}

/// The server's log: what it printed this run, beside the one before.
fn log_file(home: &Path) -> Option<(fs::File, PathBuf)> {
  fs::create_dir_all(home).ok()?;
  let path = home.join("app.log");
  let _ = fs::rename(&path, home.join("app.previous.log"));
  Some((fs::File::create(&path).ok()?, path))
}

fn tail(path: &Path) -> String {
  let text = fs::read_to_string(path).unwrap_or_default();
  let lines: Vec<&str> = text.lines().collect();
  lines[lines.len().saturating_sub(20)..].join("\n")
}

/// Shows why Seismic could not go on, and ends the app.
fn fail(app: &AppHandle, why: String) {
  app.dialog().message(why).title("Seismic").kind(MessageDialogKind::Error).blocking_show();
  app.exit(1);
}

fn start_server(app: &AppHandle, home: &Path, port: u16, log: &(fs::File, PathBuf)) -> std::io::Result<Child> {
  // beside this program (a sidecar), or on Linux among the resources (desktop/tauri.linux.conf.json)
  let beside = std::env::current_exe()?.with_file_name(SERVER);
  let server = match app.path().resource_dir() {
    Ok(dir) if !beside.exists() => dir.join(SERVER),
    _ => beside,
  };
  let mut cmd = match checkout() {
    Some(checkout) => {
      let mut cmd = Command::new(bun());
      // in the checkout, as `bun start` runs there (started from the desktop, the shell's own directory is `/`)
      cmd.arg(checkout.join("src").join("server").join("main.ts")).current_dir(&checkout);
      cmd
    }
    None => Command::new(server),
  };
  // the default home is left to the server: it moves ~/.obeya to ~/.seismic before it opens it
  if seismic_env("HOME").is_some() {
    cmd.env("SEISMIC_HOME", home).env("OBEYA_HOME", home);
  }
  cmd
    .args(["--port", &port.to_string()])
    // its entry in the home says so (`orphaned`)
    .env("SEISMIC_FROM_APP", "1")
    .env("OBEYA_FROM_APP", "1")
    .stdin(Stdio::null())
    .stdout(log.0.try_clone()?)
    .stderr(log.0.try_clone()?);
  if let (Ok(dir), None) = (app.path().resource_dir(), checkout()) {
    cmd.env("SEISMIC_RESOURCES", dir.join("resources"));
    cmd.env("OBEYA_RESOURCES", dir.join("resources"));
  }
  no_window(&mut cmd);
  cmd.spawn()
}

/// For a console program the shell runs (the server, git, bun): on Windows, without this, a
/// console window would open beside the app.
pub(crate) fn no_window(cmd: &mut Command) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  #[cfg(not(windows))]
  let _ = cmd;
}

/// Brings up the Seismic of this home (the running one, else a new server) and shows its project;
/// ends the app when that server has ended.
fn serve(app: AppHandle, seismic: Arc<Seismic>, updates: Arc<update::Updates>, handed_over: bool) {
  let home = home();
  let attach = |port: u16| {
    if let Err(error) = navigate(&app, &seismic, port, handed_over) {
      fail(&app, format!("Seismic could not open its local workspace: {error}"));
    }
  };
  loop {
    if let Some(port) = running(&home) {
      attach(port);
      if !watch(&app, &seismic, &home) {
        return;
      }
      // it ended for this shell to start it under itself: the window comes back on the page it showed
      let page = main_window(&app).and_then(|w| window::page(&w, &Own::Local(Some(port))));
      *seismic.first.lock().unwrap() = page;
    }
    if let Started::Ended = start(&app, &seismic, &updates, &home, &attach) {
      return;
    }
  }
}

/// How a start of the server came out.
enum Started {
  /// It ran, and has ended (the app with it, or for an update).
  Ended,
  /// Another start on this home got there first: the server said so and ended.
  Beaten,
}

/// Starts the server, shows its project once it answers, and waits for it to end.
fn start(app: &AppHandle, seismic: &Seismic, updates: &update::Updates, home: &Path, attach: &dyn Fn(u16)) -> Started {
  let Some(log) = log_file(home) else {
    fail(
      app,
      format!("Seismic cannot write to {}.", home.display()),
    );
    return Started::Ended;
  };
  let port = pick_port();
  let mut child = match start_server(app, home, port, &log) {
    Ok(c) => c,
    Err(e) => {
      fail(
        app,
        format!("Seismic could not be started: {e}"),
      );
      return Started::Ended;
    }
  };
  let started = Instant::now();
  while !answers(port) {
    if let Ok(Some(status)) = child.try_wait() {
      if running(home).is_some() {
        return Started::Beaten;
      }
      fail(app, ended(status, &log.1));
      return Started::Ended;
    }
    if started.elapsed() > START_PATIENCE {
      fail(
        app,
        format!("Seismic does not answer.\n\n{}", tail(&log.1)),
      );
      return Started::Ended;
    }
    thread::sleep(Duration::from_millis(150));
  }
  attach(port);
  seismic.child.store(true, Ordering::SeqCst);
  match child.wait() {
    Ok(status) if status.code() == Some(update::EXIT) => update::install(app, seismic, updates),
    Ok(status) if status.success() || seismic.stopping.load(Ordering::SeqCst) => app.exit(0),
    Ok(status) => fail(app, ended(status, &log.1)),
    Err(e) => fail(app, e.to_string()),
  }
  Started::Ended
}

fn ended(status: std::process::ExitStatus, log: &Path) -> String {
  format!("Seismic ended ({status}).\n\n{}", tail(log))
}

/// An Seismic the shell did not start in this run (an earlier run of the app did, or a terminal): the
/// app ends with it. One that runs without the app that started it (`orphaned`) is asked to end once
/// its workers paused (`POST /api/app-takeover`); true once it has (its entry says so, `takenOver`),
/// for this shell to start it again under itself. A stop meanwhile ends it for good, the app with it.
fn watch(app: &AppHandle, seismic: &Seismic, home: &Path) -> bool {
  let port = seismic.port.load(Ordering::SeqCst);
  let mut silent = 0;
  let mut taking = false;
  loop {
    thread::sleep(Duration::from_secs(1));
    if !taking && !seismic.stopping.load(Ordering::SeqCst) && orphaned(home) {
      taking = post(port, "/api/app-takeover", &serde_json::json!({})).is_some_and(|a| a["taking"] == true);
    }
    silent = if answers(port) { 0 } else { silent + 1 };
    // a restart keeps the home's entry, marked while new dependencies go in (up to 90 s, as a start
    // waits for it); a stop ends it for good and gives the entry up
    let entry = fs::read_to_string(home.join("server.json")).ok();
    let stopped = seismic.stopping.load(Ordering::SeqCst) || entry.is_none();
    if silent > 0 && !stopped && entry.as_ref().is_some_and(|e| e.contains("\"takenOver\"")) {
      return true;
    }
    let patience = if entry.is_some_and(|e| e.contains("\"restarting\"")) { 90 } else { 30 };
    if silent > 0 && stopped || silent > patience {
      app.exit(0);
      return false;
    }
  }
}

/// Shows the project once it answers, signed in, and tells it to stop when the owner quit meanwhile.
fn navigate(app: &AppHandle, seismic: &Seismic, port: u16, handed_over: bool) -> Result<(), String> {
  let next = seismic.first.lock().unwrap().take().unwrap_or_else(|| "/".into());
  let page = Url::parse(&login_link(port, &next, false)).map_err(|e| e.to_string())?;
  tauri::async_runtime::block_on(desks::on_ui(app.clone(), move |app| desks::connect_local(app, port, page, handed_over)))?;
  seismic.port.store(port, Ordering::SeqCst);
  if seismic.stopping.load(Ordering::SeqCst) {
    http(port, "POST", "/api/stop");
  }
  Ok(())
}

/// The owner quits: Seismic is told to stop, and the app waits for it (true).
fn quit(app: &AppHandle, seismic: &Seismic) -> bool {
  let first = !seismic.stopping.swap(true, Ordering::SeqCst);
  match seismic.port.load(Ordering::SeqCst) {
    // still starting: told once it answers
    0 => true,
    port => {
      if first {
        // the project shows what the stop waits for
        show(app);
      }
      http(port, "POST", "/api/stop").is_some()
    }
  }
}

pub(crate) fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Whether the shell may start again now without the owner noticing more than the pages reloading:
/// its windows are out of sight (closed on a Mac), or one is in front with the owner in it, where the
/// new ones take their place. Not while one is minimized or they are behind another app's windows,
/// where the new windows would come up on top of what the owner works in.
pub(crate) fn may_relaunch(app: &AppHandle) -> bool {
  let windows: Vec<WebviewWindow> = app.webview_windows().into_values().collect();
  // a minimized window counts as not visible on a Mac
  let minimized = windows.iter().any(|w| w.is_minimized().unwrap_or(false));
  let shown = windows.iter().any(|w| w.is_visible().unwrap_or(true));
  let front = windows.iter().any(|w| w.is_focused().unwrap_or(false));
  !minimized && (!shown || front)
}

/// Starts the shell again, whichever build is in its place now, with its windows as they were
/// (window/placed.rs); the server runs on unless it ended already. On a Mac through the system, as the
/// Dock starts it, once this one has ended: run from this process instead, the new shell would count
/// as this one's for the system's permissions (the microphone), which ends with it.
pub(crate) fn relaunch(app: &AppHandle, seismic: &Seismic, _placed: &[placed::Placed]) {
  seismic.relaunching.store(true, Ordering::SeqCst);
  #[cfg(target_os = "macos")]
  {
    // …/Seismic.app/Contents/MacOS/seismic
    let bundle = std::env::current_exe().ok().and_then(|e| Some(e.parent()?.parent()?.parent()?.to_path_buf()));
    if let Some(bundle) = bundle.filter(|b| b.extension().is_some_and(|x| x == "app")) {
      let hidden = !_placed.iter().any(|p| p.visible);
      // Launch Services can still have the old app registered when its process is gone.
      let started = Command::new("/bin/sh")
        .args(["-c", r#"while kill -0 "$1" 2>/dev/null; do sleep 0.1; done; exec /usr/bin/open -n $3 "$2""#, "sh"])
        .arg(std::process::id().to_string())
        .arg(&bundle)
        // out of sight it stays so, without coming to the front
        .arg(if hidden { "-g" } else { "" })
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
      if started.is_ok() {
        return app.exit(0);
      }
    }
  }
  app.restart();
}

fn main() {
  let seismic = Arc::new(Seismic::default());
  let for_setup = seismic.clone();
  // started again by the shell before it (`relaunch`): this machine's window first, then the others
  let mut placed = placed::take(&home());
  let main_placed = placed.first().filter(|p| p.desk == desks::LOCAL).cloned();
  placed.retain(|p| p.desk != desks::LOCAL);
  *seismic.first.lock().unwrap() = main_placed.as_ref().map(|p| p.next.clone());
  let builder = tauri::Builder::default();
  // a window that was out of sight comes back so, and the app stays behind the one the owner is in
  #[cfg(target_os = "macos")]
  let builder = builder.activate_ignoring_other_apps(main_placed.as_ref().is_none_or(|p| p.visible) || placed.iter().any(|p| p.visible));
  let app = builder
    .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
    // the opener's functions only, not its plugin: that puts a script into the page that takes each click
    // on a link with target=_blank and hands it to the plugin over IPC, which the page may not call
    // (desks/mod.rs, `PAGE`), so the click would do nothing; the shell opens such links itself
    .plugin(tauri_plugin_dialog::init())
    // system notifications, which the project page asks for when a card needs the owner (desks/mod.rs, `PAGE`)
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      desks::commands::desks,
      desks::commands::open_desk,
      desks::commands::add_desk,
      desks::commands::rename_desk,
      desks::commands::pair_desk,
      desks::commands::remove_desk,
      desks::commands::retry_desk,
    ])
    .setup(move |app| {
      let handle = app.handle().clone();
      let _ = HOME.set(home());
      app.manage(Arc::new(desks::Shell::new(home())));
      if cfg!(target_os = "macos") {
        app.set_menu(menu::menu(&handle)?)?;
      }
      let for_menu = for_setup.clone();
      app.on_menu_event(move |app, event| {
        let id = event.id().as_ref();
        if id == "browser" {
          let front = app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false));
          if let Some(w) = front.or_else(|| main_window(app)) {
            if let Ok(url) = w.url() {
              let (label, port) = desks::shell(app).local();
              open_outside(port.filter(|_| w.label() == label), &url);
            }
          }
        } else if let Some(desk) = id.strip_prefix(menu::DESK) {
          let _ = desks::open(app, desk, None);
        } else if id == "quit" && !quit(app, &for_menu) {
          app.exit(0);
        }
      });
      let main = window::build(&handle, desks::STARTUP, Own::Local(None), main_placed.as_ref(), false)?;
      main.navigate(window::bundled_url("/"))?;
      if main_placed.as_ref().is_none_or(|p| p.visible) {
        main.show()?;
      }
      desks::reopen(&handle, std::mem::take(&mut placed));
      let updates = update::start(&handle, for_setup.clone());
      let seismic = for_setup.clone();
      let handed_over = main_placed.is_some();
      thread::spawn(move || serve(handle, seismic, updates, handed_over));
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("the app could not be built");
  app.run(move |app, event| match event {
    RunEvent::ExitRequested { code: None, api, .. } => {
      if quit(app, &seismic) {
        api.prevent_exit();
      }
    }
    RunEvent::WindowEvent {
      label,
      event: WindowEvent::CloseRequested { api, .. },
      ..
    } if label == desks::shell(app).local().0 => {
      api.prevent_close();
      if cfg!(target_os = "macos") {
        // as Mac apps do: the window goes, the app stays in the Dock
        if let Some(w) = main_window(app) {
          let _ = w.hide();
        }
      } else if !quit(app, &seismic) {
        app.exit(0);
      }
    }
    // a remote workspace's window closes for good; opened again, it asks its workspace anew
    RunEvent::WindowEvent { label, event: WindowEvent::Destroyed, .. } => desks::closed(app, &label),
    RunEvent::WindowEvent { event: WindowEvent::Focused(true), .. } => menu::refresh(app),
    RunEvent::WindowEvent {
      label,
      event: WindowEvent::DragDrop(drag),
      ..
    } if label == desks::shell(app).local().0 => {
      if let Some(w) = main_window(app) {
        dragged(&w, &drag);
      }
    }
    #[cfg(target_os = "macos")]
    RunEvent::Reopen { .. } => show(app),
    // ended without asking (the Dock's Quit, logging out): the server is told on the way out and
    // stops on its own once its workers paused
    RunEvent::Exit if !seismic.stopping.load(Ordering::SeqCst) && !seismic.relaunching.load(Ordering::SeqCst) => {
      http(seismic.port.load(Ordering::SeqCst), "POST", "/api/stop");
    }
    _ => {}
  });
}
