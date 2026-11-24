// The active workspace can list or switch workspaces. Only this machine's page can change the list.
// An error is a code the pages turn into words: `address` (no address of a Seismic), `known` (a
// workspace is at that origin already), `unknown`, `local` (this machine's workspace stays),
// `unsaved`, and from a pairing `wrongCode`, `codeExpired`, `onThisMachine`, `unreachable`,
// `notSeismic`, `elsewhere` (the link led to another origin), `invalid`.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url, Webview};

use super::{capture, changed, list, on_ui, open, open_paired, remote, shell, Capture};
use crate::window::Own;

/// Whether this machine's window, at its own origin, called: the one that may change the list.
fn from_this_machine(app: &AppHandle, webview: &Webview) -> Result<(), String> {
  let state = shell(app);
  let here = state.desk_of(webview.label()).is_some_and(|(_, own)| {
    matches!(own, Own::Local(Some(port)) if state.local_port() == Some(port)) && webview.url().is_ok_and(|u| own.at(&u))
  });
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

/// Selects the workspace in the same native window.
#[tauri::command]
pub async fn open_desk(app: AppHandle, webview: Webview, id: String) -> Result<(), String> {
  let (send, mut receive) = tauri::async_runtime::channel(1);
  on_ui(app, move |app| {
    if !shell(app).is_current(webview.label()) {
      return Err("superseded".into());
    }
    open(app, &id, false, Some(send))
  }).await?;
  receive.recv().await.ok_or_else(|| "window".to_string())?
}

async fn outgoing(app: &AppHandle) -> Result<Capture, String> {
  let app = app.clone();
  tauri::async_runtime::spawn_blocking(move || capture(&app)).await.map_err(|e| e.to_string())?
}

/// Pairs with the Seismic at `address` by the code its "Connect a device" shows, and once that went
/// through keeps it on the list (named `name`, blank for its host): `{ id, opened }`.
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
  let outgoing = outgoing(&app).await;
  on_ui(app, move |app| {
    from_this_machine(app, &webview)?;
    let id = {
      let mut desks = shell.desks.lock().unwrap();
      let mut added = desks.clone();
      let desk = added.add(name.as_deref().unwrap_or_default(), &origin)?;
      shell.save(&added)?;
      *desks = added;
      desk.id
    };
    let opened = finish_pairing(app, &id, &origin, link, outgoing);
    Ok(json!({ "id": id, "opened": opened }))
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
/// there once the pairing went through). Seismic switches to its new login link where it can (`{ opened }`).
#[tauri::command]
pub async fn pair_desk(app: AppHandle, webview: Webview, id: String, code: String, address: Option<String>) -> Result<Value, String> {
  from_this_machine(&app, &webview)?;
  let (before, revision) = on_ui(app.clone(), {
    let id = id.clone();
    move |app| {
      let shell = shell(app);
      let before = shell.desks.lock().unwrap().get(&id).ok_or("unknown")?.origin.clone().ok_or("local")?;
      let revision = shell.views.lock().unwrap().revision(&id);
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
  let outgoing = outgoing(&app).await;
  on_ui(app, move |app| {
    from_this_machine(app, &webview)?;
    {
      let mut desks = shell.desks.lock().unwrap();
      if desks.get(&id).and_then(|d| d.origin.as_deref()) != Some(before.as_str()) || shell.views.lock().unwrap().revision(&id) != revision {
        return Err("unknown".into());
      }
      if origin != before {
        let mut moved = desks.clone();
        moved.move_to(&id, &origin)?;
        shell.save(&moved)?;
        *desks = moved;
      }
    }
    Ok(json!({ "opened": finish_pairing(app, &id, &origin, link, outgoing) }))
  })
  .await
}

/// The pairing was accepted and any list change saved. Opening its window is a separate outcome.
fn finish_pairing(app: &AppHandle, id: &str, origin: &str, link: Url, outgoing: Result<Capture, String>) -> bool {
  let opened = open_paired(app, id, origin, link, outgoing).map_err(|error| {
    eprintln!("seismic: the paired workspace at {origin} could not open: {error}");
  });
  changed(app);
  opened.is_ok()
}

/// Removes a remote workspace and its saved route and drafts.
#[tauri::command]
pub async fn remove_desk(app: AppHandle, webview: Webview, id: String) -> Result<(), String> {
  from_this_machine(&app, &webview)?;
  on_ui(app, move |app| {
    from_this_machine(app, &webview)?;
    let shell = shell(app);
    {
      let mut desks = shell.desks.lock().unwrap();
      let mut removed = desks.clone();
      removed.remove(&id)?;
      shell.save(&removed)?;
      *desks = removed;
    }
    shell.views.lock().unwrap().invalidate(&id);
    changed(app);
    Ok(())
  })
  .await
}

fn status_window(app: &AppHandle, label: &str) -> Result<Webview, String> {
  let w = app.get_webview(label).filter(|_| shell(app).is_current(label)).ok_or("unknown")?;
  if w.url().is_ok_and(|url| url == crate::window::bundled_url("/status.html")) {
    Ok(w)
  } else {
    Err("unknown".into())
  }
}

/// The status page's "Try again": asks the calling window's workspace again whether it answers, and
/// where it does, the window returns to its last page; else why not (`unreachable`, `notSeismic`).
#[tauri::command]
pub async fn retry_desk(app: AppHandle, webview: Webview) -> Result<(), String> {
  let label = webview.label().to_string();
  let (origin, turn) = on_ui(app.clone(), {
    let label = label.clone();
    move |app| {
      status_window(app, &label)?;
      let state = shell(app);
      let mut views = state.views.lock().unwrap();
      let Some(Own::Remote(origin)) = views.active.as_ref().map(|v| v.own.clone()) else {
        return Err("unknown".into());
      };
      views.cancel();
      Ok((origin, views.turn))
    }
  }).await?;
  let at = origin.clone();
  let health = tauri::async_runtime::spawn_blocking(move || remote::health(&at))
    .await
    .map_err(|e| e.to_string())?;
  on_ui(app, move |app| {
    let w = status_window(app, &label)?;
    let state = shell(app);
    let mut views = state.views.lock().unwrap();
    if views.turn != turn {
      return Err("superseded".into());
    }
    let active = views.active.as_mut().ok_or("unknown")?;
    if health != remote::Health::Seismic {
      active.problem = Some(health.code());
      return Err(health.code().into());
    }
    let start = Url::parse(&format!("{origin}{}", active.next)).map_err(|e| e.to_string())?;
    active.problem = None;
    drop(views);
    if let Err(error) = w.navigate(start) {
      let mut views = state.views.lock().unwrap();
      if let Some(active) = views.active.as_mut().filter(|v| v.label == label) {
        active.problem = Some("unreachable");
      }
      return Err(error.to_string());
    }
    Ok(())
  }).await
}
