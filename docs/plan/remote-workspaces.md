# Remote workspaces in the desktop app

## Goal

The desktop app shows Seismic running on other machines (another desktop app's server, or a `bun start` reachable over the network) beside this machine's, as *workspaces*. The owner adds one with its address and the 6-digit code of "Connect a device", switches between them, renames and removes them. A first attempt (2026-11-22, kept on the branch `backup/desktop-architecture`) switched one window between origins and was reset on 2026-11-23: every fix uncovered another race between the shell, the webview's navigation and the remote page's calls, about 70 cards in a day. This plan removes those races by construction instead of handling them one by one.

## Shape

Three rules carry the design:

1. **One window per workspace, one origin per window.** Each workspace opens in its own native window, whose webview shows that workspace's origin and nothing else for the window's life. Switching focuses another window (opening it if closed); it never navigates a webview to another origin. The navigation hook hands any navigation off the window's origin to the system browser. A workspace the shell finds down shows the shell's bundled status page in its window (try again, open another), the only other page a workspace window may show.
2. **The shell pairs over HTTP, never through the webview.** The shell posts the address and code to the server itself and learns the outcome from the response: Seismic answers, the code is right, or it is not. Only after that does it open the workspace's window, at a one-time login link of that origin that sets the device cookie in the webview and leads on to the start page, as `/login?token=` already does for the owner's link (`src/server/owner.ts`). Nothing is judged from navigation events.
3. **Remote pages get a small, fixed set of shell commands, granted when their window is created.** Listing the workspaces, focusing or opening one (which never moves the calling window), moving the window from its bar and showing a notification. The capability names the window and its one origin; it never grows or needs taking back, since a removed workspace's window closes with it. Adding, pairing, editing and removing workspaces happen only on this machine's own page, which holds the commands that change the list.

**Workspaces list:** kept by the shell in its home (one file), one entry per origin. This machine's workspace is always on it and cannot be removed. In code a workspace stays a *desk* (the word *workspace* already names the former projects and the Koordinator's pool), and the UI strings say "workspace".

**Where the owner manages them:** this machine's Seismic page has the workspaces page (list, "New workspace", the cog's dialog with rename, address, "Pair again" and "Delete workspace"). Every page, a remote one's too, shows the switcher in the left menu, built from the list command; its cog leads to this machine's page. The macOS menu lists the workspaces as well.

**Pairing a remote:** `POST /api/pair` on the remote takes the code and answers with a one-time login link (single use, valid for a minute) or why not (wrong code, expired). An explicit code is redeemed even where the browser is already paired. Device cookies are named per scheme and port (`seismic-device-https-8443`), so two Seismics on one host and the `http://` and `https://` addresses of one keep their own pairing. Phones and browsers pair through `/pair` as today.

**After a relaunch:** the shell reopens the windows that were open, each at its own workspace's start page or last page at that origin.

## Workstreams

- [ ] **W1:** Spike on all three webviews (WKWebView, WebView2, WebKitGTK). Prove that a second window opened at a one-time login link keeps the device cookie for later loads at that origin, that the navigation hook keeps the window on its origin (redirects and frames included), and that a capability scoped to one window and one origin admits only that window's calls. Write the result and any platform quirk into this plan before W3 starts. If a webview cannot do one of these, stop and bring it to the owner.
- [ ] **W2:** Server side. `POST /api/pair` with the one-time login link; device cookies per scheme and port, with the renewal rules (bring back the device-cookie commits from `backup/desktop-architecture`: per-scheme names, explicit-code redemption, the `device_renewals` credential handover); tests with two Seismics on one host paired by one cookie jar. Independent of W1.
- [ ] **W3:** Shell. The workspace list and its file, one window per workspace with its fixed capability, the navigation guard, the shell's health check before a window opens and the status page when it fails, reopening windows after a relaunch, the macOS menu. The microphone is granted to listed origins only (bring back that commit). Builds on W1 and W2.
- [ ] **W4:** Pages. The workspaces page and cog dialog on this machine's page, the switcher in every page's left menu, the setup's first step ("How do you want to use Seismic?" with "On this machine" and "Remote connection"), and a remote Seismic without projects offering "Set up <its name>" or "Connect to remote Seismic". shadcn/ui parts, strings in `src/ui/strings.ts`, the phone view untouched. The UI work of the backup branch (wrapping long addresses, "Learn more" outside the radio label, "Delete workspace" in the cog's dialog alone) carries over as decisions, not as code.
- [ ] **W5:** Windows and Linux. The app check in CI on WebView2 (bring back that commit) covers pairing, switching and a removed workspace's window; a Linux run in its container. User guide page in `docs/site/` and its sidebar entry. Demo video of the whole feature on a Mac.
- [ ] **W6:** Move the decisions and constraints into a design chapter (`docs/design/desktop-workspaces.md`, linked from `docs/design.md`) and delete this plan doc.

## Boundaries

The web app does not change how it reaches its server: every page is served by the Seismic it talks to, over relative REST paths and a WebSocket at `location.host`. The shell is a container that keeps the list and pairs over HTTP. What carries over from the first attempt is listed per workstream; the rest of `desktop/src/desks.rs` does not. No syncing of the list between machines.

Rejected (2026-11-23):

- **One window switching between origins** (the first attempt): the shell had to tell from each webview's navigation events whether a pairing went through and which page a call came from, across three engines that report them differently.
- **Pairing by sending the window to the remote `/pair`:** the outcome had to be read off redirects, frames and late page loads instead of an HTTP response.
- **Capabilities granted at runtime as the list grows, with a guard per call:** Tauri cannot take a runtime capability back, and on Linux wry attributes a late call to the page the window shows.
- **One bundled front end in the app talking to many servers' APIs:** it needs a configurable API base, token auth instead of cookies (the WebSocket included), CORS or a proxy in the shell, one app version compatible with every server version, and a second way of shipping the UI beside the server's.
- **Tauri's multiple webviews in one window** (a native sidebar beside one webview per workspace): behind Tauri 2's `unstable` feature. Rule 1 holds for it too, so it can replace separate windows later without changing the rest.
