---
title: Install
description: How to install Seismic.
---

The install guide lives on its own page: **[Install Seismic](/install/)**.

:::note[Coming soon]
For now Seismic is built from source; the page walks through it. Official release channels are
coming soon.
:::

Once Seismic runs, set up each repository it works on with its
[repository settings](/docs/reference/settings/).

## Switch desktop workspaces

On macOS, open the **Workspace** menu to switch between this machine and your paired workspaces.
The menu marks the current workspace. Choosing another workspace loads its address in the same
app window. Press **Control–Command–1** for this machine and **Control–Command–2** through
**Control–Command–9** for the next eight workspaces in menu order. Returning to a workspace
brings back its last page and unsent drafts. If this machine’s server stops while you are working
in a remote workspace, you can keep working there. Start the local server again to switch back.

When a draft attachment is still uploading, choose **Switch after upload** to keep it in your
draft. **Discard and switch** cancels the pending attachment. **Go back** keeps the current
workspace open and the upload running. The prompt requires an updated workspace and desktop app.
If the local server restarts on a new port, **Go back** lets you keep working while the upload
finishes. The app then reconnects automatically. When adding or pairing a workspace again,
**Go back** leaves the pairing code unused. If the code expires while you wait for the upload,
get a new one from the workspace you are pairing.
When a server reconnects at the same address, its page waits for pending uploads before
reloading. If you chose **Switch after upload**, the app opens the selected workspace when the
upload finishes.
After the upload, the current workspace stays visible while Seismic checks the destination.
If the selected workspace has come online, it opens directly. Adding or pairing a workspace
again checks that its address serves Seismic before opening it.

### Reconnect an offline workspace

When the selected workspace is unreachable, the app shows its address and the reason it could
not connect. Choose **Try again** to return to your last page when the server is reachable, or
choose another workspace under **Switch workspace**. On macOS, **File → Open in Browser**
(**Shift–Command–B**) opens the workspace’s address in your browser.

If you go Back to the status screen after reconnecting, **Try again** checks the workspace again
and recovers unsent conversations, issue drafts, and settings edits. If Seismic cannot save the
current workspace’s drafts, reconnect it or use Forward to return to its page, then try again.

### After an update

Seismic restores the selected workspace in the app window and keeps unsent drafts from workspaces
you switched away from. A selected remote workspace reopens even if this machine’s server cannot
start. If the remote workspace is offline, the app opens its recovery screen.
If Seismic cannot save your work for the restart, it defers the update. A downloaded release remains
available to install again. For a source checkout, a queued rebuild retries automatically.
If you use a terminal to run Seismic’s server, the desktop app waits to restart while its window
is minimized or behind another app. On macOS, closing the window lets the rebuild retry in the
background and keeps the window closed until you reopen it.
If you switch workspaces while the app prepares to restart, it retries with the workspace you
switched to.

Seismic keeps a copy of a malformed workspace list as `app-desks.unreadable.json` in its home
directory. Later backups get numbered filenames.

On macOS Big Sur, the desktop app disables microphone and camera capture. Desktop dictation
requires macOS Monterey or newer.
