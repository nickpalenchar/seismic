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
The menu marks the workspace in front. Selecting a workspace brings its window forward or opens
it if it’s closed. Press **Control–Command–1** for this machine, and **Control–Command–2** through
**Control–Command–9** for the next eight workspaces in menu order.

### Reconnect an offline workspace

When a workspace is unreachable, its window shows a status screen with the address and the reason
it could not connect. Choose **Try again** when the server is reachable to return to the page you
last had open, or choose another workspace under **Open another workspace**. Seismic shows progress
when opening a window and lets you retry if it fails. On macOS, **File → Open in Browser**
(**Shift–Command–B**) opens the offline workspace’s saved address in your browser.

If you go Back to the status screen after reconnecting, **Try again** checks the workspace again.
Unsent conversations, issue drafts, and settings edits are saved locally across updates, including
when you restart from the status screen.
If Seismic cannot save a workspace’s drafts, it keeps the window open. Reconnect the workspace or
use Forward to return to its page, then try the update again.

### After an update

The desktop app restores your open workspace windows after an update. A workspace that takes
longer to reconnect opens in the background if it was in the background before the update. If
Seismic reports that it could not save the open windows, it defers the update and keeps them open.
If the installer reports an error and Seismic restarts, it restores the windows and drafts as they
were when the error dialog closed.
If the remote server takes too long to return drafts during startup, the workspace opens with the
drafts Seismic saved on this device.
If a workspace window fails to reopen, opening it again can recover those drafts. A second restart
also keeps windows that are still waiting for their first connection check.
If a workspace reconnects while Seismic is preparing another restart, its draft carries over too.

The local window stays minimized when Seismic reconnects it to a server on a different port.

Seismic keeps a copy of a malformed workspace list as `app-desks.unreadable.json` in its home
directory. Later backups get numbered filenames.

On macOS Big Sur, the desktop app disables microphone and camera capture. Desktop dictation
requires macOS Monterey or newer.
