# Vendored crates

`wry/` is wry 0.57.3 from crates.io (the version Tauri 2.12.7 uses here), without its examples, with
one change: `src/wkwebview/class/wry_web_view_delegate.rs` drops a postMessage IPC call unless it
comes from the main frame at its document's own effective origin (`main_frame_at_its_origin`).
WKWebView names such a call by the frame's document URL, so a sandboxed frame at a workspace's URL
would pass as that workspace (docs/plan/remote-workspaces.md, "macOS gate"). `Cargo.toml` takes it
in place of the crates.io wry (`[patch.crates-io]`).

Moving to a newer wry: copy its crate from `~/.cargo/registry/src/*/wry-<version>/` (src, build.rs,
the licenses, Cargo.toml without its `[[example]]` tables), apply the change again, and run the
"Webview spike" workflow.
