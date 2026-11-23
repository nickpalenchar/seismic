// The macOS menu: the system's default one, with "Open in Browser" in File, a Quit that stops
// Seismic first, and the workspaces in a menu of their own (⌃⌘1 … 9), the one of the window in
// front checked. Made anew whenever the list, the windows or the window in front change.

use std::sync::Arc;

use tauri::{
  menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, Submenu},
  AppHandle, Manager,
};

use crate::desks::{Shell, LOCAL};

/// The id of the menu item of workspace `id`.
pub const DESK: &str = "desk:";

fn desks(app: &AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
  let shell = app.state::<Arc<Shell>>();
  let front = app
    .webview_windows()
    .into_iter()
    .find(|(_, w)| w.is_focused().unwrap_or(false))
    .and_then(|(label, _)| shell.desk_of(&label))
    .map_or_else(|| LOCAL.to_string(), |(id, _)| id);
  let list = shell.desks.lock().unwrap().list.clone();
  let menu = Submenu::with_id(app, "desks", "Workspace", true)?;
  for (i, d) in list.iter().enumerate() {
    let key = (i < 9).then(|| format!("Cmd+Ctrl+{}", i + 1));
    menu.append(&CheckMenuItem::with_id(
      app,
      format!("{DESK}{}", d.id),
      d.shown_name(shell.machine()),
      true,
      d.id == front,
      key.as_deref(),
    )?)?;
  }
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
