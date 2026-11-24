fn main() {
  // with an app manifest, each command of the shell needs a permission a capability grants
  // (allow-desks, ...): capabilities/ and the ones src/desks/mod.rs grants each window as it is made
  let manifest = tauri_build::AppManifest::new().commands(&[
    "desks", "open_desk", "add_desk", "rename_desk", "pair_desk", "remove_desk", "retry_desk", "workspace_start_dragging", "workspace_toggle_maximize",
    "workspace_draft_checkpoint",
  ]);
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("tauri build");
}
