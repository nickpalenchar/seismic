// The macOS menu: the system's default one, with "Open in Browser" in File, a Quit that stops
// Seismic first, and the workspaces in a menu of their own (⌃⌘1 … 9), with the current one checked, and "New Workspace…".

use std::sync::Arc;

use tauri::{
  menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
  AppHandle, Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::desks::{self, Shell};

/// The id of the menu item of workspace `id`.
pub const DESK: &str = "desk:";
/// The id of "New Workspace…", which opens this machine's workspaces page with the form to pair one.
pub const NEW_DESK: &str = "new-desk";

/// Keep the menu responsive while the switch waits for attachments and the destination.
pub fn select(app: &AppHandle, id: &str, page: Option<&str>) {
  let (send, mut receive) = tauri::async_runtime::channel(1);
  let queued = desks::open(app, id, false, Some(send), page.map(str::to_owned));
  crate::show(app);
  let app = app.clone();
  let new_workspace = page.is_some();
  let local = id == desks::LOCAL;
  tauri::async_runtime::spawn(async move {
    let result = match queued {
      Ok(()) => receive.recv().await.unwrap_or_else(|| Err("window".into())),
      Err(error) => Err(error),
    };
    let Err(error) = result else { return };
    let why = match error.as_str() {
      "cancelled" | "superseded" => return,
      "unreachable" if local => "Seismic on this machine isn’t responding. Start the local server and try again.",
      "drafts" => "Seismic couldn’t keep this page’s unsent drafts. Try again.",
      "unknown" => "The workspace is no longer on the list.",
      _ => "Seismic couldn’t open the destination. Try again.",
    };
    let title = if new_workspace { "Couldn’t open New Workspace" } else { "Couldn’t switch workspaces" };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
      if !crate::is_stopping(&handle) {
        let dialog = handle.dialog().message(why).title(title).kind(MessageDialogKind::Error);
        let dialog = match crate::main_window(&handle) {
          Some(window) => dialog.parent(&window),
          None => dialog,
        };
        dialog.show(|_| {});
      }
    });
  });
}

fn desks(app: &AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
  let shell = app.state::<Arc<Shell>>();
  let current = shell.current();
  let list = shell.desks.lock().unwrap().list.clone();
  let menu = Submenu::with_id(app, "desks", "Workspace", true)?;
  for (i, d) in list.iter().enumerate() {
    let key = (i < 9).then(|| format!("Cmd+Ctrl+{}", i + 1));
    menu.append(&CheckMenuItem::with_id(
      app,
      format!("{DESK}{}", d.id),
      d.shown_name(shell.machine()),
      true,
      d.id == current,
      key.as_deref(),
    )?)?;
  }
  menu.append(&PredefinedMenuItem::separator(app)?)?;
  menu.append(&MenuItem::with_id(app, NEW_DESK, "New Workspace…", true, None::<&str>)?)?;
  Ok(menu)
}

pub fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
  let menu = Menu::default(app)?;
  let browser = MenuItem::with_id(app, "browser", "Open in Browser", true, Some("CmdOrCtrl+Shift+B"))?;
  let items = menu.items()?;
  // the default menu's File menu, after the app's own
  if let Some(MenuItemKind::Submenu(file)) = items.get(1) {
    file.insert(&browser, 0)?;
  }
  // the default Quit (the app menu's last item) ends the app at once, which a Mac does not let an app
  // put off: this one stops Seismic first, as closing the window does elsewhere
  if let Some(MenuItemKind::Submenu(own)) = items.first() {
    let n = own.items()?.len();
    own.remove_at(n - 1)?;
    own.append(&MenuItem::with_id(app, "quit", "Quit Seismic", true, Some("CmdOrCtrl+Q"))?)?;
  }
  // before the Window menu
  let at = items
    .iter()
    .position(|i| matches!(i, MenuItemKind::Submenu(s) if s.text().is_ok_and(|t| t == "Window")))
    .unwrap_or(items.len());
  menu.insert(&desks(app)?, at)?;
  Ok(menu)
}

/// The menu anew, with the workspaces as they are now.
pub fn refresh(app: &AppHandle) {
  if cfg!(target_os = "macos") {
    if let Ok(m) = menu(app) {
      let _ = app.set_menu(m);
    }
  }
}
