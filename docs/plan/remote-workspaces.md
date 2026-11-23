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

- [ ] **W1:** Spike on all three webviews (WKWebView, WebView2, WebKitGTK). Prove that a second window opened at a one-time login link keeps the device cookie for later loads at that origin over HTTP and HTTPS, that the navigation hook keeps the window on its origin (redirects and frames included), and that shell commands are scoped to their window and the caller's effective origin. Before W3 starts, verify a WKWebView mitigation for opaque-origin callers and the HTTPS cookie path on the remaining engines.
- [x] **W2:** Server side. `POST /api/pair` with the one-time login link; device cookies per scheme and port, with the renewal rules (bring back the device-cookie commits from `backup/desktop-architecture`: per-scheme names, explicit-code redemption, the `device_renewals` credential handover); pairing again keeps the device's credential instead of handing over a new one, as the design doc says why; tests with two Seismics on one host paired by one cookie jar. Independent of W1.
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
IPC behavior against the versions W3 ships. The original runs used HTTP loopback. The HTTPS cookie
check uses trusted TLS on loopback and exercises native pairing, the login redirect, a browser reload
and a separate app launch. HTTPS results apply to the cookie lifecycle only. The HTTPS check passed
for both workspace windows in the WebKitGTK container. The workflow now runs it on all three runners.

| | WKWebView (macOS 27) | WebKitGTK 2.50 (Ubuntu 22.04, Xvfb) | WebView2 (Windows runner) |
|---|---|---|---|
| HTTP device cookie (`SameSite=Lax`), kept after the login redirect, on a second load and after a relaunch; link single use | observed | observed | observed |
| HTTPS device cookie (`SameSite=None; Secure`), checked after the login redirect, on reload and after a relaunch; link single use | pending | observed in both windows | pending |
| `on_navigation` keeps the window on its origin: location, link, 302 to another origin, form post, meta refresh, frames of another origin and a frame redirected to one; `window.open` goes to `on_new_window` | yes, before any request leaves | yes, before any request leaves | yes, with the shell guarding frames itself; a refused GET still reaches its server |
| Per-window capability and frame origin | **Exception:** two opaque-origin sandboxed frames reached native commands | no out-of-scope command recorded with postMessage unregistered | no out-of-scope command recorded |

**Owner decision:** W3 must enforce the caller's effective origin. Deny shell commands from
opaque-origin frames even when their document URL matches the workspace. W1 will verify that
a WKWebView mitigation blocks those calls while the workspace's own page can still use its
granted commands. In normal macOS operation, keeping the invoke key out of subframes provides
an additional protection.

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
  fetch IPC, which names its sender by the `Origin` header and works from remote http pages there;
  with it, nothing passes. W3 unregisters it on every Linux window.
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
- **Opaque-origin sandboxed frames** (artifacts, answer pages): the macOS artifact records native
  commands from both test frames when supplied the fixture's invoke key. WKWebView attributed the
  messages by the frames' document URLs, which match their respective workspace origins. The
  spike reports those events as an exception to effective-origin isolation. Linux with
  postMessage enabled also recorded opaque-origin calls. In the Linux run with postMessage
  unregistered and in the Windows run, no sandboxed-frame command was recorded.
- **Cookies:** the windows share the app's one cookie store; cookies ignore the port, so the
  per-scheme-and-port cookie names of W2 are what keep two Seismics on one host apart.

## Boundaries

The web app does not change how it reaches its server: every page is served by the Seismic it talks to, over relative REST paths and a WebSocket at `location.host`. The shell is a container that keeps the list and pairs over HTTP. What carries over from the first attempt is listed per workstream; the rest of `desktop/src/desks.rs` does not. No syncing of the list between machines.

Rejected (2026-11-23):

- **One window switching between origins** (the first attempt): the shell had to tell from each webview's navigation events whether a pairing went through and which page a call came from, across three engines that report them differently.
- **Pairing by sending the window to the remote `/pair`:** the outcome had to be read off redirects, frames and late page loads instead of an HTTP response.
- **Capabilities granted at runtime as the list grows, with a guard per call:** Tauri cannot take a runtime capability back, and on Linux wry attributes a late call to the page the window shows.
- **One bundled front end in the app talking to many servers' APIs:** it needs a configurable API base, token auth instead of cookies (the WebSocket included), CORS or a proxy in the shell, one app version compatible with every server version, and a second way of shipping the UI beside the server's.
- **Tauri's multiple webviews in one window** (a native sidebar beside one webview per workspace): behind Tauri 2's `unstable` feature. Rule 1 holds for it too, so it can replace separate windows later without changing the rest.
