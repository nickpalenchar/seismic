# Vendored crates

`wry/` is wry 0.57.3 from crates.io (the version Tauri 2.12.7 uses here), without its examples.
On macOS, `src/wkwebview/class/wry_web_view_delegate.rs` drops a postMessage IPC call unless it
comes from the main frame at its document's own effective origin (`main_frame_at_its_origin`).
WKWebView names such a call by the frame's document URL, so a sandboxed frame at a workspace's URL
would pass as that workspace. See [Webview engine constraints](../../docs/design/desktop-workspaces.md#webview-engine-constraints) for the platform rationale.
`Cargo.toml` takes it in place of the crates.io wry (`[patch.crates-io]`).

On Linux, `src/webkitgtk/mod.rs` subscribes to the `ipc` message name only. The shell disables
that Tauri channel but adds a separate one-way channel for draft recovery. Listening for every
message name would also route that channel's messages into the general IPC decoder.
The same GTK backend scopes download callbacks to the originating webview and disconnects the
context subscription when that view is dropped. A shared context announces downloads from every view.

On desktop, the page-load handler reports `Started` at the start of a main-document load:
WKWebView's provisional navigation, WebKitGTK's `LoadEvent::Started`, or an allowed WebView2
`NavigationStarting`. The navigation policy still checks subframes where the engine reports them.
WKWebView and WebView2 match completions to their latest start by navigation identity, so a late
completion cannot supersede a newer load. The synchronous desktop event context distinguishes
commit from provisional start through Tauri's page-load callback. It also reports when
WKWebView turns a main-frame response into a download or reports a cancellation for the
current provisional navigation, WebKitGTK reports a provisional policy
interruption, or WebView2 reports cancellation of the current navigation ID.

Moving to a newer wry: copy its crate from `~/.cargo/registry/src/*/wry-<version>/` (src, build.rs,
the licenses, Cargo.toml without its `[[example]]` tables), then reapply these changes.

## Verify the desktop bundle

On macOS, build the actual desktop bundle from the repository root and run its workspace check:

```sh
(cd desktop && bun x tauri build --debug --bundles app --config '{"identifier":"im.seismic.desks-check","bundle":{"externalBin":null,"resources":null}}')
bun scripts/check-app-desks.ts desktop/target/debug/bundle/macos/Seismic.app/Contents/MacOS/seismic
```

The check exercises workspace navigation in the shipping shell. Its IPC probe sends inert
malformed messages from the main page, a same-origin frame and an opaque
sandboxed frame. Both frames must report that they sent a message, while Tauri's decoder must see
only the main page's message. The separate Webview spike compares engines using its own build.
