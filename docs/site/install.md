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

**Workspace → New Workspace…** opens the pairing form on this machine. If the local server
cannot be reached, Seismic shows a message and keeps your current workspace open. When adding
or pairing a workspace again, enter the address first. If you change the address, enter a fresh
code for that machine.
Pairing keeps the current form open until the connection succeeds or reports a problem.
If project settings have an unsaved draft, **Stay** keeps the draft open and **Discard and close**
opens the requested Workspaces page.

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

### Reconnect an unresponsive workspace

If the app cannot open the selected workspace, it shows **&lt;workspace&gt; is unresponsive** with
the workspace’s name in the heading. Read the reason below it. It shows the workspace’s address
and explains what happened, including when Seismic answers but its page fails to load.
Choose **Try again** to reopen your last page, or choose another workspace under
**Switch workspace**. **Recovery help**, beside **Try again**, opens the public Seismic guide
in your system browser. On macOS, **File → Open in Browser**
(**Shift–Command–B**) opens the workspace’s address in your browser.

If you go Back to the status screen after reconnecting, **Try again** checks the workspace again
and recovers unsent conversations, issue drafts, and settings edits. If Seismic cannot save the
current workspace’s drafts, reconnect it or use Forward to return to its page, then try again.

### After an update

Seismic restores the selected workspace in the app window and keeps unsent drafts from workspaces
you switched away from. A selected remote workspace reopens even if this machine’s server cannot
start. If the app cannot load the remote workspace, it opens the recovery screen described above.
If Seismic cannot save your work for the restart, it defers the update. A downloaded release remains
available to install again. For a source checkout, a queued rebuild retries automatically.
If you use a terminal to run Seismic’s server, the desktop app waits to restart while its window
is minimized or behind another app. On macOS, closing the window lets the rebuild retry in the
background and keeps the window closed until you reopen it.
If you switch workspaces while the app prepares to restart, it retries with the workspace you
switched to. If you edit a draft during preparation, Seismic retries with the newer draft.
It waits if you start dictating or playing a demo in the displayed workspace.

Seismic keeps a copy of a malformed workspace list as `app-desks.unreadable.json` in its home
directory. Later backups get numbered filenames.

On macOS Big Sur, the desktop app disables microphone and camera capture. Desktop dictation
requires macOS Monterey or newer.
