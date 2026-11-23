// The shell's commands for the workspaces. Each window's capability grants its pages some of them
// (mod.rs, `PAGE` and `LOCAL_PAGE`; desktop/capabilities/status.json for the bundled status page):
// every page lists the workspaces and focuses or opens one, which never moves the calling window;
// only this machine's page changes the list. Tauri refuses a call its capability does not grant;
// the ones that change the list ask besides that this machine's window, at its own origin, called.
//
// An error is a code the pages turn into words: `address` (no address of a Seismic), `known` (a
// workspace is at that origin already), `unknown`, `local` (this machine's workspace stays),
// `unsaved`, and from a pairing `wrongCode`, `codeExpired`, `onThisMachine`, `unreachable`,
// `notSeismic`, `elsewhere` (the link led to another origin), `invalid`.

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url, Webview};

use super::{changed, close, list, open, open_paired, remote, shell, MAIN};
use crate::Seismic;

/// Whether this machine's window, at its own origin, called: the one that may change the list.
fn from_this_machine(app: &AppHandle, webview: &Webview) -> Result<(), String> {
  let seismic = app.state::<Arc<Seismic>>();
  let here = webview.label() == MAIN && webview.url().is_ok_and(|u| seismic.serves(&u));
  if here {
    Ok(())
  } else {
    Err("notHere".into())
  }
}

/// The workspaces: `{ current, problem, list: [{ id, name, origin, local, open }] }`, `current` the
/// one of the calling window, `problem` why its status page shows (mod.rs, `Shell::view`).
#[tauri::command]
pub fn desks(app: AppHandle, webview: Webview) -> Value {
  shell(&app).view(webview.label())
}

/// Focuses workspace `id`'s window, opening it where it is closed; the calling window stays where it is.
#[tauri::command]
pub fn open_desk(app: AppHandle, id: String) -> Result<(), String> {
  open(&app, &id, None)
}

/// Pairs with the Seismic at `address` by the code its "Connect a device" shows, and once that went
/// through keeps it on the list (named `name`, blank for its host) and opens its window: `{ id }`.
#[tauri::command]
pub async fn add_desk(app: AppHandle, webview: Webview, address: String, code: String, name: Option<String>) -> Result<Value, String> {
  from_this_machine(&app, &webview)?;
  let origin = list::origin(&address).ok_or("address")?;
  let shell = shell(&app);
  if shell.desks.lock().unwrap().at_origin(&origin).is_some() {
    return Err("known".into());
  }
  let at = origin.clone();
  let link = tauri::async_runtime::spawn_blocking(move || remote::pair(&at, &code))
    .await
    .map_err(|e| e.to_string())??;
  let id = format!("w{}", crate::now_ms());
  {
    let mut desks = shell.desks.lock().unwrap();
    let before = desks.clone();
    desks.add(id.clone(), name.as_deref().unwrap_or_default(), &origin)?;
    if let Err(e) = shell.save(&desks) {
      *desks = before;
      return Err(e);
    }
  }
  open_paired(&app, &id, link)?;
  changed(&app);
  Ok(json!({ "id": id }))
}

/// Names workspace `id` `name`; blank gives it its default (the machine's or the host's name).
#[tauri::command]
pub fn rename_desk(app: AppHandle, webview: Webview, id: String, name: String) -> Result<(), String> {
  from_this_machine(&app, &webview)?;
  let shell = shell(&app);
  {
    let mut desks = shell.desks.lock().unwrap();
    let mut renamed = desks.clone();
    renamed.rename(&id, &name)?;
    shell.save(&renamed)?;
    *desks = renamed;
  }
  changed(&app);
  Ok(())
}

/// Pairs remote workspace `id` again by `code`, at `address` where it is given (the workspace moves
/// there once the pairing went through; its window, at the old origin, closes): its window opens
/// at the new link.
#[tauri::command]
pub async fn pair_desk(app: AppHandle, webview: Webview, id: String, code: String, address: Option<String>) -> Result<(), String> {
  from_this_machine(&app, &webview)?;
  let shell = shell(&app);
  let desk = shell.desks.lock().unwrap().get(&id).cloned().ok_or("unknown")?;
  let before = desk.origin.clone().ok_or("local")?;
  let origin = match address.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
    Some(a) => list::origin(a).ok_or("address")?,
    None => before.clone(),
  };
  if shell.desks.lock().unwrap().at_origin(&origin).is_some_and(|d| d.id != id) {
    return Err("known".into());
  }
  let at = origin.clone();
  let link = tauri::async_runtime::spawn_blocking(move || remote::pair(&at, &code))
    .await
    .map_err(|e| e.to_string())??;
  if origin != before {
    let mut desks = shell.desks.lock().unwrap();
    let mut moved = desks.clone();
    moved.move_to(&id, &origin)?;
    shell.save(&moved)?;
    *desks = moved;
  }
  open_paired(&app, &id, link)?;
  changed(&app);
  Ok(())
}

/// Takes remote workspace `id` off the list; its window closes.
#[tauri::command]
pub fn remove_desk(app: AppHandle, webview: Webview, id: String) -> Result<(), String> {
  from_this_machine(&app, &webview)?;
  let shell = shell(&app);
  {
    let mut desks = shell.desks.lock().unwrap();
    let mut removed = desks.clone();
    removed.remove(&id)?;
    shell.save(&removed)?;
    *desks = removed;
  }
  close(&app, &id);
  changed(&app);
  Ok(())
}

/// The status page's "Try again": asks the calling window's workspace again whether it answers, and
/// where it does, the window goes to its start page; else why not (`unreachable`, `notSeismic`).
#[tauri::command]
pub async fn retry_desk(app: AppHandle, webview: Webview) -> Result<(), String> {
  let shell = shell(&app);
  let label = webview.label().to_string();
  let (_, origin) = shell.desk_of(&label).ok_or("unknown")?;
  let origin = origin.ok_or("local")?;
  let at = origin.clone();
  let health = tauri::async_runtime::spawn_blocking(move || remote::health(&at))
    .await
    .map_err(|e| e.to_string())?;
  let problem = (health != remote::Health::Seismic).then(|| health.code());
  if let Some(o) = shell.windows.lock().unwrap().open.get_mut(&label) {
    o.problem = problem;
  }
  if let Some(problem) = problem {
    return Err(problem.into());
  }
  let start = Url::parse(&format!("{origin}/")).map_err(|e| e.to_string())?;
  webview.navigate(start).map_err(|e| e.to_string())
}
