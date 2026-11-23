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

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url, Webview};

use super::{changed, close, list, on_ui, open, open_paired, remote, shell};
use crate::window::Own;

/// Whether this machine's window, at its own origin, called: the one that may change the list.
fn from_this_machine(app: &AppHandle, webview: &Webview) -> Result<(), String> {
  let (label, port) = shell(app).local();
  let here = webview.label() == label && webview.url().is_ok_and(|u| Own::Local(port).at(&u));
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
pub async fn open_desk(app: AppHandle, id: String) -> Result<(), String> {
  on_ui(app, move |app| open(app, &id, None)).await
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
  on_ui(app, move |app| {
    let id = format!("w{}", crate::now_ms());
    {
      let mut desks = shell.desks.lock().unwrap();
      let mut added = desks.clone();
      added.add(id.clone(), name.as_deref().unwrap_or_default(), &origin)?;
      shell.save(&added)?;
      *desks = added;
    }
    open_paired(app, &id, &origin, link)?;
    changed(app);
    Ok(json!({ "id": id }))
  })
  .await
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
  let (before, revision) = on_ui(app.clone(), {
    let id = id.clone();
    move |app| {
      let shell = shell(app);
      let before = shell.desks.lock().unwrap().get(&id).ok_or("unknown")?.origin.clone().ok_or("local")?;
      let revision = shell.windows.lock().unwrap().revision(&id);
      Ok((before, revision))
    }
  })
  .await?;
  let origin = match address.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
    Some(a) => list::origin(a).ok_or("address")?,
    None => before.clone(),
  };
  let shell = shell(&app);
  if shell.desks.lock().unwrap().at_origin(&origin).is_some_and(|d| d.id != id) {
    return Err("known".into());
  }
  let at = origin.clone();
  let link = tauri::async_runtime::spawn_blocking(move || remote::pair(&at, &code))
    .await
    .map_err(|e| e.to_string())??;
  on_ui(app, move |app| {
    {
      let mut desks = shell.desks.lock().unwrap();
      if desks.get(&id).and_then(|d| d.origin.as_deref()) != Some(before.as_str()) || shell.windows.lock().unwrap().revision(&id) != revision {
        return Err("unknown".into());
      }
      if origin != before {
        let mut moved = desks.clone();
        moved.move_to(&id, &origin)?;
        shell.save(&moved)?;
        *desks = moved;
      }
    }
    open_paired(app, &id, &origin, link)?;
    changed(app);
    Ok(())
  })
  .await
}

/// Takes remote workspace `id` off the list; its window closes.
#[tauri::command]
pub async fn remove_desk(app: AppHandle, webview: Webview, id: String) -> Result<(), String> {
  from_this_machine(&app, &webview)?;
  on_ui(app, move |app| {
    let shell = shell(app);
    {
      let mut desks = shell.desks.lock().unwrap();
      let mut removed = desks.clone();
      removed.remove(&id)?;
      shell.save(&removed)?;
      *desks = removed;
    }
    shell.windows.lock().unwrap().invalidate(&id);
    close(app, &id);
    changed(app);
    Ok(())
  })
  .await
}

fn status_window(app: &AppHandle, label: &str) -> Result<tauri::WebviewWindow, String> {
  let w = app.get_webview_window(label).ok_or("unknown")?;
  if w.url().is_ok_and(|url| url == crate::window::bundled_url("/status.html")) {
    Ok(w)
  } else {
    Err("unknown".into())
  }
}

/// The status page's "Try again": asks the calling window's workspace again whether it answers, and
/// where it does, the window goes to its start page; else why not (`unreachable`, `notSeismic`).
#[tauri::command]
pub async fn retry_desk(app: AppHandle, webview: Webview) -> Result<(), String> {
  let label = webview.label().to_string();
  let (origin, revision) = on_ui(app.clone(), {
    let label = label.clone();
    move |app| {
      status_window(app, &label)?;
      let shell = shell(app);
      let windows = shell.windows.lock().unwrap();
      let open = windows.open.get(&label).filter(|o| o.problem.is_some()).ok_or("unknown")?;
      Ok((open.origin.clone(), windows.revision(&open.desk)))
    }
  })
  .await?;
  let at = origin.clone();
  let health = tauri::async_runtime::spawn_blocking(move || remote::health(&at))
    .await
    .map_err(|e| e.to_string())?;
  on_ui(app, move |app| {
    let w = status_window(app, &label)?;
    let shell = shell(app);
    let problem = (health != remote::Health::Seismic).then(|| health.code());
    let mut windows = shell.windows.lock().unwrap();
    let open = windows
      .open
      .get(&label)
      .filter(|o| o.problem.is_some() && windows.revision(&o.desk) == revision)
      .ok_or("unknown")?;
    let id = open.desk.clone();
    if let Some(problem) = problem {
      windows.open.get_mut(&label).unwrap().problem = Some(problem);
      return Err(problem.into());
    }
    let start = Url::parse(&format!("{origin}/")).map_err(|e| e.to_string())?;
    // Publish before the new page can query its state. Release the lock before calling Tauri.
    windows.open.get_mut(&label).unwrap().problem = None;
    drop(windows);
    if let Err(error) = w.navigate(start) {
      let mut windows = shell.windows.lock().unwrap();
      if windows.revision(&id) == revision {
        if let Some(o) = windows.open.get_mut(&label) {
          o.problem = Some("unreachable");
        }
      }
      return Err(error.to_string());
    }
    Ok(())
  })
  .await
}
