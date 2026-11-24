# Vendored crates

`wry/` is wry 0.57.3 from crates.io (the version Tauri 2.12.7 uses here), without its examples, with
one change: `src/wkwebview/class/wry_web_view_delegate.rs` drops a postMessage IPC call unless it
comes from the main frame at its document's own effective origin (`main_frame_at_its_origin`).
WKWebView names such a call by the frame's document URL, so a sandboxed frame at a workspace's URL
would pass as that workspace (docs/plan/remote-workspaces.md, "macOS gate"). `Cargo.toml` takes it
in place of the crates.io wry (`[patch.crates-io]`).

Moving to a newer wry: copy its crate from `~/.cargo/registry/src/*/wry-<version>/` (src, build.rs,
the licenses, Cargo.toml without its `[[example]]` tables), then apply the change again. On macOS,
build the actual desktop bundle from the repository root and run its workspace check:

```sh
(cd desktop && bun x tauri build --debug --bundles app --config '{"identifier":"im.seismic.desks-check","bundle":{"externalBin":null,"resources":null}}')
bun scripts/check-app-desks.ts desktop/target/debug/bundle/macos/Seismic.app/Contents/MacOS/seismic
```

The IPC check sends inert malformed messages from the main page, a same-origin frame and an opaque
sandboxed frame. Both frames must report that they sent a message, while Tauri's decoder must see
only the main page's message. The separate Webview spike compares engines using its own build.
