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

The desktop app restores your open workspace windows after an update. A workspace that takes
longer to reconnect opens in the background if it was in the background before the update. If
Seismic reports that it could not save the open windows, it defers the update and keeps them open.
If the installer reports an error and Seismic restarts, it restores the windows and drafts as they
were when the error dialog closed.
If the remote server takes too long to return drafts during startup, the workspace opens with the
drafts Seismic saved on this device.
If a workspace window fails to reopen, opening it again can recover those drafts. A second restart
also keeps windows that are still waiting for their first connection check.

On a workspace status screen, **File → Open in Browser** opens the workspace’s saved address.

On macOS Big Sur, the desktop app disables microphone and camera capture. Desktop dictation
requires macOS Monterey or newer.
