# Remote workspaces in the desktop app

## Goal

The desktop app shows Seismic running on other machines (another desktop app's server, or a `bun start` reachable over the network) beside this machine's, as *workspaces*. The owner adds one with its address and the 6-digit code of "Connect a device", switches between them, renames and removes them. A first attempt (2026-11-22, kept on the branch `backup/desktop-architecture`) switched one window between origins and was reset on 2026-11-23: every fix uncovered another race between the shell, the webview's navigation and the remote page's calls, about 70 cards in a day. This plan removes those races by construction instead of handling them one by one.

## Shape

Three rules carry the design:

1. **One window per workspace, one origin per window.** Each workspace opens in its own native window, whose webview shows that workspace's origin and nothing else for the window's life. Switching focuses another window (opening it if closed); it never navigates a webview to another origin. The navigation hook hands any navigation off the window's origin to the system browser. A workspace the shell finds down shows the shell's bundled status page in its window (try again, open another), the only other page a workspace window may show.
2. **The shell pairs over HTTP, never through the webview.** The shell posts the address and code to the server itself and learns the outcome from the response: Seismic answers, the code is right, or it is not. Only after that does it open the workspace's window, at a one-time login link of that origin that sets the device cookie in the webview and leads on to the start page, as `/login?token=` already does for the owner's link (`src/server/owner.ts`). Nothing is judged from navigation events.
3. **Remote pages get a small, fixed set of shell commands, granted when their window is created.** Listing the workspaces, focusing or opening one (which never moves the calling window), moving the window from its bar and showing a notification. The capability names the window and its one origin; it never grows or needs taking back, since a removed workspace's window closes with it. The shell authorizes calls using the caller's effective origin and denies opaque-origin callers even when their document URL matches the workspace. Adding, pairing, editing and removing workspaces happen only on this machine's own page, which holds the commands that change the list.

**Workspaces list:** kept by the shell in its home (one file), one entry per origin. This machine's workspace is always on it and cannot be removed. In code a workspace stays a *desk* (the word *workspace* already names the former projects and the Koordinator's pool), and the UI strings say "workspace".

**Where the owner manages them:** this machine's Seismic page has the workspaces page (list, "New workspace", the cog's dialog with rename, address, "Pair again" and "Delete workspace"). Every page, a remote one's too, shows the switcher in the left menu, built from the list command; its cog leads to this machine's page. The macOS menu lists the workspaces as well.

**Pairing a remote:** `POST /api/pair` on the remote takes the code and answers with a one-time login link (single use, valid for a minute) or why not (wrong code, expired). An explicit code is redeemed even where the browser is already paired. Device cookies are named per scheme and port (`seismic-device-https-8443`), so two Seismics on one host and the `http://` and `https://` addresses of one keep their own pairing. The answer is `200 { url, expires }` or `401 { code: "wrongCode" }`, `410 { code: "codeExpired" }` (also for a code already used), `400` for anything but JSON `{ code }`, `409 { code: "onThisMachine" }` from this machine; a wrong code spends one of the code's five tries, as on `/pair` (`src/server/remote.ts`, `pairApi`). Phones and browsers pair through `/pair` as today.

**After a relaunch:** the shell reopens the windows that were open, each at its own workspace's start page or last page at that origin.

## Workstreams

- [x] **W1:** Spike on all three webviews (WKWebView, WebView2, WebKitGTK). Prove that a second window opened at a one-time login link keeps the device cookie for later loads at that origin over HTTP and HTTPS, that the navigation hook keeps the window on its origin (redirects and frames included), and that shell commands are scoped to their window and the caller's effective origin. Before W3 starts, verify a WKWebView mitigation for opaque-origin callers and the HTTPS cookie path on the remaining engines.
- [x] **W2:** Server side. `POST /api/pair` with the one-time login link; device cookies per scheme and port, with the renewal rules (bring back the device-cookie commits from `backup/desktop-architecture`: per-scheme names, explicit-code redemption, the `device_renewals` credential handover); the handover's new cookie gets a name of its own, so late answers cannot overwrite a newer one; tests with two Seismics on one host paired by one cookie jar. Independent of W1.
- [ ] **W3:** Shell. The workspace list and its file, one window per workspace with its fixed capability, enforcement of the caller's effective origin, the navigation guard, the shell's health check before a window opens and the status page when it fails, reopening windows after a relaunch, the macOS menu. The microphone is granted to listed origins only (bring back that commit). Builds on W1 and W2.
- [ ] **W4:** Pages. The workspaces page and cog dialog on this machine's page, the switcher in every page's left menu, the setup's first step ("How do you want to use Seismic?" with "On this machine" and "Remote connection"), and a remote Seismic without projects offering "Set up <its name>" or "Connect to remote Seismic". shadcn/ui parts, strings in `src/ui/strings.ts`, the phone view untouched. The UI work of the backup branch (wrapping long addresses, "Learn more" outside the radio label, "Delete workspace" in the cog's dialog alone) carries over as decisions, not as code.
- [ ] **W5:** Windows and Linux. The app check in CI on WebView2 (bring back that commit) covers pairing, switching and a removed workspace's window; a Linux run in its container. User guide page in `docs/site/` and its sidebar entry. Demo video of the whole feature on a Mac.
- [ ] **W6:** Move the decisions and constraints into a design chapter (`docs/design/desktop-workspaces.md`, linked from `docs/design.md`) and delete this plan doc.

## W1 results (2026-11-23)

The spike is `desktop/spike/` (a small Tauri app, `src/main.rs`, and its harness, `run.ts`, which
serves this machine's origin, two workspaces and a foreign site on 127.0.0.1 and judges what the
shell and the pages report); `desktop/spike/linux.sh` runs it on WebKitGTK in the Linux image, and
the "Webview spike" workflow on all three GitHub runners (by hand, and on a push that changes the
spike). The results use Tauri 2.12.7 and wry 0.57.3, from `desktop/spike/Cargo.lock`. The desktop
shell currently locks Tauri 2.12.1 and wry 0.57.0 in `desktop/Cargo.lock`. Verify navigation and
IPC behavior against the versions W3 ships. The navigation checks ran over HTTP loopback. The HTTPS
run (`https.sh`, trusted TLS on loopback, on disposable runners or the Linux container only) covers
native pairing, the login redirect, a reload and a separate app launch, then the frames check with
the guard off and each engine's IPC mitigation on.

The table records the earlier W1 observations, including hosted run 45236604449 on 2026-11-23.
Its HTTPS assertions covered the cookie lifecycle, the main pages' native commands and the absence
of unexpected native calls.

| | WKWebView (macOS 27) | WebKitGTK 2.50 (Ubuntu 22.04, Xvfb) | WebView2 (Windows runner) |
|---|---|---|---|
| HTTP device cookie (`SameSite=Lax`), kept after the login redirect, on a second load and after a relaunch; link single use | observed | observed | observed |
| HTTPS device cookie (`SameSite=None; Secure`), checked after the login redirect, on reload and after a relaunch; link single use | observed | observed | observed |
| `on_navigation` keeps the window on its origin: location, link, 302 to another origin, form post, meta refresh, frames of another origin and a frame redirected to one; `window.open` goes to `on_new_window` | yes, before any request leaves | yes, before any request leaves | yes, with the shell guarding frames itself; a refused GET still reaches its server |
| Per-window capability and frame origin | opaque-origin sandboxed frames reached native commands over wry's postMessage in the HTTP comparison; the gated runs recorded no sandboxed frame commands over HTTP and HTTPS | no out-of-scope command recorded with postMessage unregistered, over HTTP and HTTPS | no out-of-scope command recorded, over HTTP and HTTPS |

The strengthened checks require each frame's effective origin and outcomes for invoke, raw fetch
and postMessage. Where raw fetch is available, the same-origin control must return its granted
command's reply and produce a matching native record. The other probes must show the capability
denial at the caller's origin or the sandboxed frame's opaque-origin rejection. WKWebView over
HTTPS has a separate expectation for a browser-level fetch block and verifies the native
postMessage gate independently.

| Strengthened run (2026-11-23) | HTTP | HTTPS |
|---|---|---|
| WKWebView | Passed on the Mac, including independent gate checks for a same-origin subframe and a main frame at another origin | Pending on the hosted matrix |
| WebKitGTK | Passed in the Linux container | Passed in the Linux container, including both native raw fetch controls and explicit rejections |
| WebView2 | Pending on the hosted matrix | Pending on the hosted matrix |

**Owner decision:** W3 must enforce the caller's effective origin. Deny shell commands from
opaque-origin frames even when their document URL matches the workspace. On macOS the spike
requires the gate below to drop same-origin and sandboxed subframes as well as a main frame loaded
at a different effective origin. Each workspace's own top page must still reach its granted
command. Keeping the invoke key out of subframes (Tauri's default there) protects in addition.

What W3 builds on:

- **Capabilities at window creation:** `add_capability` with `window(label)`,
  `remote(origin)`, `local(false)` and the app command's permission (`build.rs` lists the commands in
  an `AppManifest`, so a command without a granting capability is denied). Calls from another window,
  from the other workspace's origin and from this machine's page are denied with Tauri's message
  naming the capability, subject to the frame-attribution limits below.
- **The hook sees subframes and redirects:** a 302 from the window's origin to another one reaches
  `on_navigation` with the target URL, for the main frame and for frames (macOS and Linux), and
  returning `false` stops it before the request is sent (the foreign server saw no request). So
  there the hook alone keeps foreign frames out. It is given only the URL, not whether a frame asked, so
  handing every refused URL to the system browser would let a page open browser tabs by embedding
  frames: W3 decides which refused navigations go to the browser.
- **Linux quirk (WebKitGTK):** wry's postMessage IPC names the page the webview shows, not the
  frame that sent the call, so a foreign frame holding the invoke key passes as the window's page
  (the spike shows it: `ping_a` ran for a frame of the foreign origin in `desk-a`). Unregistering
  wry's `ipc` script message handler (as `437dbe6a` on `backup/desktop-architecture` did) leaves the
  fetch IPC, which names its sender by the `Origin` header and works from remote HTTP and HTTPS
  pages there. In the strengthened runs it accepted both same-origin controls and rejected the
  other probes. W3 unregisters the postMessage handler on every Linux window.
- **macOS gate (WKWebView):** wry hands Tauri a postMessage call with the frame's document URL
  (`frameInfo.request.URL`), so a sandboxed frame at the workspace's URL passes as the workspace.
  Removing the handler, as on Linux, is no fix there: the fetch IPC (`ipc://localhost`) left over
  cannot be reached from an `https://` page on WKWebView, so the windows' own commands hang (seen
  on the runner). What works: let wry's handler run only for a message whose `frameInfo.isMainFrame`
  is true and whose `frameInfo.securityOrigin` is the window's origin (an opaque origin reports an
  empty protocol); every other message is dropped, same-origin subframes too, which W3 does not
  need. The spike swaps the method of wry's `WryWebViewDelegate` class (objc2 names it with a
  generated suffix, so it is found by that part of its name) for one that checks first; W3 should
  carry the check as a patch to wry, or upstream it, rather than swap a method at runtime.
- **Windows quirks (WebView2):** wry hooks `NavigationStarting` only, so frames never reach
  `on_navigation` and a foreign frame loads. The shell adds its own `FrameNavigationStarting`
  handler on the window's `ICoreWebView2` (`with_webview`, then `controller().CoreWebView2()`, as
  `desktop/spike/src/main.rs` does) and cancels off-origin frames; with it no foreign page renders.
  And WebView2 sends a navigation's GET while it asks the handler: a refused navigation (main frame
  or frame, a redirect's target too) still reaches its server, though its answer is dropped and the
  window stays; a form POST was not sent. The window stays on its origin; if a request leaving
  matters, `WebResourceRequested` with a filter is where it could be stopped (not tried).
- **Subframes get no Tauri internals on macOS and Linux** (Tauri's init scripts are main frame
  only), so a frame cannot call the shell unless it learns the invoke key. On Windows, wry adds init
  scripts to subframes regardless (wry's docs), so there a frame has `__TAURI_INTERNALS__` and the
  key: the capability and the frame guard are what stop it, and the run shows they do (the foreign
  frame's fetch IPC names its own origin and is denied; a frame's postMessage never reaches the
  shell there).
- **Opaque-origin sandboxed frames** (artifacts, answer pages): given the invoke key, they reach
  native commands over postMessage on macOS and on Linux with wry's handler in place (the spike
  still records that as an exception in those runs, to show the mitigations stay needed). With the
  macOS gate, with the handler unregistered on Linux, and on Windows, the earlier runs recorded no
  such commands over HTTP and HTTPS. The raw fetch transport rejects their `Origin: null` where it
  is reachable. WKWebView blocks the raw HTTPS fetch at the browser boundary.
- **Cookies:** the windows share the app's one cookie store; cookies ignore the port, so the
  per-scheme-and-port cookie names of W2 are what keep two Seismics on one host apart.

## W3 results (2026-11-23)

The shell is in `desktop/src/`: the list and the commands in `desks/`, the windows and what keeps
each on its origin in `window/`, the macOS menu in `menu.rs`. `scripts/check-app-desks.ts` checks
it end to end in the real app, against a second Seismic behind a proxy that forwards as
`tailscale serve` does (so it answers as another machine). The shell now locks Tauri 2.12.7 and
wry 0.57.3, the versions the spike verified.

- **The list:** `app-desks.json` in the home, the file and format the first attempt wrote
  (`{ list: [{ id, name, url }] }`; its `active` and `microphone` are read past), so a list made
  then carries over. This machine's entry has id `local` and no origin; a blank name shows the
  machine's name (this machine) or the host (a remote one).
- **Commands** (`desks/commands.rs`; errors are codes for the pages to word): every workspace page
  gets `desks` (the list, the calling window's workspace as `current`) and `open_desk`, plus moving
  the window from its bar and the notification plugin's three commands. This machine's page alone
  gets `add_desk` (address, code, name: pairs over HTTP, then keeps it and opens its window at the
  link), `rename_desk`, `pair_desk` (code, optional new address: the workspace moves once the
  pairing went through, its old window closes) and `remove_desk`; they also check that the current local window, at
  its own origin, called. The bundled status page gets `desks`, `open_desk` and `retry_desk`
  (`capabilities/status.json`). Pages hear of a change by a `seismic-desks` event on `window` and
  ask for the list again. W4 builds the pages on these.
- **Labels and capabilities:** `main-<n>` for this machine, `desk-<n>` for a remote workspace.
  Each native window has its own label and an origin fixed before its first server document loads.
  The bundled startup window has no origin grant. When the local server takes a different port,
  the shell replaces its window and closes the old webview before the replacement loads. The
  old capability matches only its retired label. A late close event cannot remove a
  replacement's tracking.
- **Effective origin:** on macOS wry is vendored (`desktop/vendor/`) with a check in its script
  message handler: only the main frame whose security origin is its document URL's origin may send
  postMessage IPC, so a sandboxed main frame and every subframe are dropped, and the capability's
  origin check does the rest. Linux windows have wry's `ipc` handler unregistered. Windows needs
  neither (W1).
- **Navigation:** a window admits its own origin and the bundled entry pages at
  `tauri://localhost` on macOS and Linux, or `http://tauri.localhost` on Windows. What it turns away opens in the system browser, at most one URL a
  second per window, as the hook cannot tell a frame's navigation from the page's. On Windows the
  shell cancels a frame's navigation off the window's origin itself (FrameNavigationStarting);
  `about:blank` and `about:srcdoc` frames stay.
- **Health check:** before a remote window opens, the shell asks `GET /api/projects` without a
  cookie. Seismic answers with its projects (`X-Seismic: projects`) or `401 { code: "notPaired" }`.
  Nothing answering or something else answering opens the window at the status page, which says
  why and offers Try again and the other workspaces. Pairing supplies a new link directly and
  supersedes any pending health check. A check is discarded if the workspace was moved or removed
  while it was running.
- **Relaunch:** `app-windows.json` (replacing `app-window.json`, still read once for a shell from
  before) lists every window with its workspace, place and page, including a remote status window.
  A remote window comes back through the health check while its workspace is still listed at that
  origin. On macOS the shell requests a fresh app instance because Launch Services can still have
  the old instance registered after its process exits.
- **Closing:** a remote window closes for good (opened again, it is checked again). The local window behaves
  as before: hidden on a Mac, quitting elsewhere.
- **Microphone:** granted to the window's own origin alone, decided by each engine's own hook (the
  three modules of `40f8e6b9`, now per window): WKWebView by the requesting frame, WebView2 by its
  origin, WebKitGTK by the committed page with other origins' frames kept out. The camera goes to
  no page. No question to the owner: a listed origin is the owner's word.
- **Drops:** files dropped on a remote window go to its page as in a browser; only the local window hands
  the page this machine's paths.
- **macOS menu:** a Workspace menu before Window lists the workspaces (⌃⌘1 … 9), the one of the
  window in front checked. "New Workspace…" waits for W4's page.

`check-app-desks.ts` uses a localhost proxy for secure-context microphone capture and forwarded
headers so Seismic still treats it as remote. On macOS it verified microphone capture in the main
page, an explicit denial in a sandboxed frame, two real relaunches while offline, and recovery with
the existing pairing. It also held open a health request while pairing again and while removing the
workspace. A bundled macOS build is needed for the pairing cookie to survive a relaunch.

The desktop unit tests passed on macOS and Linux. The WebView2 permission and frame-registration
code type-checked for Windows. W5's CI covers running the desktop app on Windows and Linux.

## Boundaries

The web app does not change how it reaches its server: every page is served by the Seismic it talks to, over relative REST paths and a WebSocket at `location.host`. The shell is a container that keeps the list and pairs over HTTP. What carries over from the first attempt is listed per workstream; the rest of `desktop/src/desks.rs` does not. No syncing of the list between machines.

Rejected (2026-11-23):

- **One window switching between origins** (the first attempt): the shell had to tell from each webview's navigation events whether a pairing went through and which page a call came from, across three engines that report them differently.
- **Pairing by sending the window to the remote `/pair`:** the outcome had to be read off redirects, frames and late page loads instead of an HTTP response.
- **Capabilities granted at runtime as the list grows, with a guard per call:** Tauri cannot take a runtime capability back, and on Linux wry attributes a late call to the page the window shows.
- **One bundled front end in the app talking to many servers' APIs:** it needs a configurable API base, token auth instead of cookies (the WebSocket included), CORS or a proxy in the shell, one app version compatible with every server version, and a second way of shipping the UI beside the server's.
- **Tauri's multiple webviews in one window** (a native sidebar beside one webview per workspace): behind Tauri 2's `unstable` feature. Rule 1 holds for it too, so it can replace separate windows later without changing the rest.
