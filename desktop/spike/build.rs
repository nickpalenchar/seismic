fn main() {
  // with an app manifest, each command needs a permission a capability grants (allow-ping-a, ...)
  let manifest = tauri_build::AppManifest::new().commands(&["ping_a", "ping_b", "ping_local"]);
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("tauri build");
}
