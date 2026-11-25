# Desktop workspaces

A desktop workspace is an entry for the local Seismic or a paired remote origin. The app shows
the projects and agents of the selected installation. The code calls these entries *desks*,
since *workspace* has also named projects and the Koordinator's workstation pool.

## Shell and workspace ownership

- **One native window, one immutable origin per workspace webview** (2026-11-23). The shell
  attaches a fresh Tauri child webview for each switch and closes the previous child only after
  the replacement attaches, so a native creation failure leaves the current page usable. This
  uses Tauri's `unstable` child-webview support. Reusing a webview across origins was rejected
  because it made the identity of late calls and the outcome of pairing depend on engine-specific
  navigation events.
- **Each server serves its own UI** (2026-11-23). The page uses relative REST paths and a WebSocket
  at its own host. A shared bundled frontend was rejected because it would require a configurable
  API base, cookie alternatives and WebSocket auth, CORS or a shell proxy, and compatibility
  between one installed UI and every server version.
- **The workspace list belongs to this desktop installation** (2026-11-23). The shell stores it
  in its own home. Each canonical HTTP(S) origin gets one entry. This machine's entry is
  permanent and has no saved origin, since its server can change ports. A local server shutdown
  or port change leaves a displayed remote workspace in place. Lists are independent across machines.
- Keep the legacy `app-desks.json` shape `{ list: [{ id, name, url }] }` and the reserved `local`
  entry. Ignore the former `active` and `microphone` fields. Migrate `app-workspaces.json` only
  when the current file is absent, and put a malformed list aside before replacing it.
- The origin excludes paths, queries and fragments. Host names containing URLPattern syntax are
  refused so a workspace address cannot widen a grant. Keep IPv6 origins canonical on disk and
  escape the host's colons only when constructing the capability pattern.

## Origin isolation

- **Tauri grants match both the webview label family and its origin** (2026-11-24). Runtime
  capabilities cannot be revoked, so register one grant for each local or remote origin family
  and give each attached view a fresh label. Reusing broad grants with per-call guards was rejected
  because the grants outlive the view and some IPC transports misattribute the sender.
- **Authorize the caller's effective origin** (2026-11-23). An opaque sandboxed frame, such as an
  artifact or answer page, must be denied even if its document URL matches the workspace. A
  workspace's main page must still reach its granted commands over HTTP and HTTPS.
- All workspace pages can list and select workspaces and use window controls and notifications.
  Only the active local workspace can change the list. Window controls act on the invoking
  webview's window without accepting a target label. The microphone is scoped to the displayed
  workspace's own origin, with no grant on bundled pages. Only the local workspace receives
  local file paths. macOS 11 disables native media capture because its older delegate gives
  only frame URLs, which cannot establish the caller's effective origin.
- Create the blank webview on the UI thread and install native guards before loading the first
  workspace document. WebView2's controller is thread-bound and WebKitGTK's media policy needs
  to see the first commit.
- The workspace view admits its origin and the bundled status page. Off-origin browser handoffs
  and popups share a rate limit because the navigation hook supplies a URL without identifying
  whether a frame requested it.

### Webview engine constraints

- **macOS (WKWebView).** wry's postMessage IPC attributes messages by the frame's document URL.
  The vendored handler admits only the main frame when its security origin matches its document
  origin, then Tauri checks the workspace grant. Keep this gate when updating wry. Removing the
  handler would also cut off HTTPS workspaces because WKWebView blocks their fetch transport
  to `ipc://localhost`.
- **Linux (WebKitGTK).** wry's postMessage IPC attributes a subframe call to the page the webview
  shows. Unregister that handler and keep fetch IPC, which attributes the caller using its
  `Origin` and rejects opaque origins. Tauri normally switches the entire document to postMessage
  after one IPC fetch failure. Return an error for that call alone so the next call still uses
  fetch. Keep the separate one-way draft recovery channel outside the general IPC decoder.
- On WKWebView and WebKitGTK the navigation hook sees main-frame and subframe redirects and can
  block them before the request leaves. Tauri's initialization scripts keep the invoke key in
  the main frame on those engines. The origin checks must hold even if a frame learns the key.
- **Windows (WebView2).** wry only hooks top-level navigation, so the shell also guards
  `FrameNavigationStarting`. WebView2 can send a GET before the policy rejects the navigation,
  including a redirect target. The guard controls what can render. Tauri initialization scripts
  and their invoke key also reach subframes here, so isolation depends on the origin capability
  and frame guard. Fetch IPC carries the sender's origin and subframe postMessage does not reach
  the shell.
- **Cross-engine checks.** The Webview spike exercises login cookies across navigation and
  relaunch, navigation and redirect policy, and effective-origin IPC on all three engines.
  Exercise both HTTP and HTTPS, including a granted top page and an opaque frame whose document
  URL matches it. The installed Windows and Linux builds also exercise workspace switching and
  recovery. Windows lacks SIGSTOP for the paused-local-server check, and the Linux container uses
  `lsof` for that check. On macOS use a bundled app to check pairing cookies across relaunch.
  Keep the Linux package build on the Bun version used by CI. An older compiler can omit a
  dynamically imported UI chunk and leave the window blank.

## Pairing

- **Pair in the shell over HTTP** (2026-11-23). The shell reads the result directly and opens
  the returned login link in the workspace's webview. Sending the webview to the interactive
  pairing form was rejected because redirects, frames and late loads made success ambiguous.
- `POST /api/pair` accepts JSON `{ code }` and returns a one-time login link with its expiry. The
  server holds the link in memory for a minute. A wrong code spends one of five tries and
  returns `401 wrongCode`. Expired or used codes return `410 codeExpired`, invalid input returns
  `400`, and attempting to pair this machine returns `409 onThisMachine`. The link must name a
  plain `host[:port]` that serves Seismic as a whole.
- Redeeming the code spends it immediately. **Connect a phone** shows that the desktop app
  claimed it while the link is valid, even past the code's deadline. Opening the link enrolls the
  device with the webview's cookie and name. For up to a day after use, the link still admits a
  browser holding the credential it issued or a later one. It can repeat a pending handover for
  the credential it was made from until its replacement is presented or retired. An expired or
  unknown link shows a pairing failure even in a paired browser (2026-11-23).
- The app's webviews share a cookie store. A paired device's cookie is named for the scheme
  and port of its address (`seismic-device-https-8443.<tag>`, or `seismic-device-http.<tag>`
  without a port). Browsers store cookies by host, so different schemes and ports would
  otherwise overwrite each other's pairing. HTTP uses `SameSite=Lax` and HTTPS uses
  `SameSite=None; Secure`. Once an address's own cookies are present, they
  decide access. The legacy names (`seismic-device-8443`, `seismic-device`, `obeya-device`)
  allow access only when those cookies are absent and are never renewed.
- Pairing again with an explicit code or link, even in a paired browser, keeps the device entry
  and hands over a new credential. Every credential is kept, hashed, in the order given. The
  browser presenting one retires those given before it, never one given after, so an answer still
  on its way keeps working whatever arrives first. A replacement is made from the credential the
  pairing brought (an HMAC with a nonce), so the same credential brought again, a retry or a
  request sent before an earlier replacement arrived, gets the same answer and keeps its device;
  a retired one lets nobody in. The tag comes from the credential's hash, including for first
  pairings. The answer unsets the cookies the request brought, so a late answer sets its cookie
  beside the newest. Where a browser opened two first pairings before receiving either answer,
  Seismic prefers the device enrolled last, even if the answers arrive in reverse order.
  A single name with a grace period was rejected because it only moves the race to a later
  renewal. Keeping the same credential on pairing again would leave a copied cookie working
  (2026-11-23).

## Management and setup

- **Manage the list on this machine** (2026-11-24). The switcher and its cog are available on
  remote workspace pages, but changes go through the local Workspaces page. Shell-requested
  page destinations are limited to the local Workspaces route and respect the current page's
  unsaved-draft decision. Changing a saved origin takes effect after pairing succeeds. Removing
  an entry affects this list alone. Revoking its device credential belongs to the remote server.
- Offer the local-versus-remote choice only on local first start. A remote without projects
  goes straight into its own setup (2026-11-24). Setup has no left-menu switcher, so
  **Exit setup** provides a way back on platforms without the macOS Workspace menu. Show it
  only when another workspace is available and confirm before switching. From a remote setup
  it goes to this machine. From local setup it goes to the first remote.
- Keep long names and addresses readable by wrapping them. The **Learn more** link sits outside
  the radio label so it can be used independently. **Delete workspace** belongs in the cog
  dialog, away from the rows used to switch workspaces.

## Switching and recovery

- Keep the current page visible through a connection check. The newest selection wins, and
  removing a pending target cancels its switch. A remote can be saved after pairing even if
  the shell cannot display its page.
- Desktop workspace health checks carry no device cookie. The shell reads at most 4 KiB from
  `GET /api/v1/health` and accepts a successful response with
  `{ service: "seismic", status: "ok" }` or Seismic's `401 notPaired`. An explicit unhealthy
  Seismic reply ends the check. For an unconfirmed reply, such as an older server's 404 or HTML
  sign-in page, fall back to `/api/projects` and require a JSON 200 marked `X-Seismic: projects`
  or `401 notPaired`. The local server checks use `/api/projects` directly because the server
  running during an update may predate the health endpoint (2026-11-24).
- A passing health check does not prove that the page loads: the server can go away in between, and
  a proxy can forward the health check while answering the workspace route with a maintenance or
  placeholder page of its own, also with status 200 or a redirect. The shell treats a workspace
  page as shown once the server answers again and the document at its origin is Seismic's own
  (its root, manifest and `apple-mobile-web-app-title` "Seismic", with a 2xx status where the
  engine reports one) or its `401` pairing form, checked when each main-document load finishes
  or 15 seconds after it starts, and otherwise shows the status page. WKWebView can leave the
  previous page in place without a completion event when a load fails. A timeout only accepts a
  document committed by that load. A main-frame response turned into a download in WKWebView
  ends the provisional load's watchdog and resumes any check of the document still visible.
  A cancelled redirect handed to the browser has the same effect on the provisional load.
  Back from recovery checks the document it restores and keeps the original retry destination
  if it returns to the rejected redirect target. Route capture and departure checkpoints
  check the page's markers together with its live route and drafts, so switching or leaving the
  workspace keeps that route while the server check is pending. An older activation's checkpoint
  cannot overwrite a route already accepted from a newer document.
  Before a rejected page at the origin gives way to the status page, the workspace route is
  fetched once past the cache and opened again: a plain navigation or reload reuses a placeholder,
  or a redirect to one, that the proxy let the cache keep. The shell owns the recovery navigation,
  including after the cache fetch completes. When only the fragment differs, recovery restores
  it before reloading so the saved canvas or anchor comes back. Recovery and Try again open
  the destination requested at main-document load start, even if the load fails before commit
  or redirects to a placeholder. Restoration keeps the last verified workspace route. A
  cancelled load keeps the visible document’s route. Exclude authentication URLs, including
  the pairing form submission endpoint, from recovery and restoration. An invalid code can
  leave the form visible without changing the saved route. A new main-document load
  supersedes older checks and pending recovery navigation as soon as it starts
  (2026-11-25).
  Selecting this machine's workspace first asks its server for a sign-in link, since the shell
  keeps the port while that server stops (2026-11-24).
- Before replacing a webview, the shell samples its last route and unsent drafts, including edits
  held in memory when session storage is full. The shell keeps that copy for the workspace and
  restores it only at its saved origin. A bundled status page uses the latest departure checkpoint.
  Resolve pending attachments before redeeming a pairing code, since the resulting link lasts
  only a minute. Run the health check above (`/api/v1/health`, then `/api/projects` for an earlier
  Seismic) before redeeming it too, so a timeout or a proxy error leaves the code usable for the
  next try; whether the pairing is still current is checked after that probe, right before the
  `POST /api/pair` (2026-11-24). Going back during automatic local reattachment waits for idle
  uploads before retrying without another prompt (2026-11-24).
  A WebSocket reconnect can also reload a page, so it waits for attachments before navigating.
  An active native switch keeps the outgoing document through draft capture and navigation.
  A same-webview navigation releases its hold by the load deadline, since a failed provisional
  load can leave the old document visible. A remote switch checks again after an attachment wait,
  and pairing verifies the origin with the workspace probe before opening a webview (2026-11-24).
  Connection requests keep the outgoing page visible. The shell hides it only when it is ready
  to sample its drafts and replace it.
  Server shutdown tracks the answering server before the local webview waits for its attachment
  decision (2026-11-24).

## Relaunch and updates

- Save one native placement and the selected workspace in `app-windows.json`, alongside each
  visited workspace's route and drafts. Older snapshots keep their routes and drafts, and the
  previously focused window supplies the selection when migrating. The saved remote can reopen
  even when this machine's server cannot start.
- A desktop rebuild checks the displayed remote workspace for activity. It asks the remote server
  with its existing pairing and reads the page's own holds. Server handover is scoped to the paired
  device and origin. The new page waits for it 1.5 s at most, fills in only keys it lacks, and frees
  the server copy by its token once applied: a read cut short at startup (a busy terminal-owned
  server, a slow proxy) no longer consumes the only copy. A late answer also reaches stores
  that have already loaded, and restores the old view if the owner has yet to use the new one
  (2026-11-24).
  When the shell is attached to a terminal's server, it finishes writing the snapshot and
  rechecks the local server and displayed workspace for activity. It then holds
  input in that webview, samples the live drafts again, and compares the workspace revision and
  window presentation on the native event thread. Closing a macOS window hides it, so a rebuild
  captured in front must retry with the hidden placement. Only the replacement given the launch
  ticket can restore the snapshot. A canceled attempt discards it, and only a primary instance
  can remove any rebuild files left by an interruption.
- The desktop app saves its selected workspace, window placement and unsent drafts before an
  installer can exit the shell, and only the primary instance consumes the snapshot. It keeps
  origin-scoped copies of unsent drafts even when the server accepts handover, since its copy
  can expire before the workspace reopens.
  If a restored page takes ownership of its draft after readiness sampling starts, the shell
  retries the capture before publishing a snapshot. An empty sample still counts as a sampled page.
  A workspace page also sends its drafts to its own native window before yielding to the status page.
  This copy uses native messaging so it does not depend on browser storage quota or a server connection.
  If session storage rejects a draft write, the page keeps the newer value in memory and includes it
  in the snapshot. The departure records the current full route, including in-page address changes.
  A returning document receives the native departure copy before it mounts its editors. An activation
  change leaves that copy pending until the receiving document confirms delivery. A document that
  stops waiting for the copy tells the shell, and from then on its own drafts take precedence over
  any copy it did not receive, including a checkpoint that arrives after its deadline (2026-11-24).
  An update that cannot confirm receipt keeps the window alive and resumes the local server.
  Failed snapshot preparation retains a downloaded release and the pending checkout rebuild.
  Automatic retries test that a snapshot can be saved before asking the server to stop again.
- The restored window uses its saved focus and placement. Native show and fullscreen calls
  can activate it, so a window saved in the background postpones fullscreen until focused.

See the [desktop workspaces guide](../site/workspaces.md) for the user flows.
