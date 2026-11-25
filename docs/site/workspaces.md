---
title: Desktop workspaces
description: Show Seismic running on another machine in the desktop app, and switch between machines.
---

The desktop app can show Seismic running on this machine or on another one: a studio at home or a
build server, say. Each Seismic the app window can show is a **workspace**. A workspace on another
machine is a remote one: its agents run over there, and you direct them from here.

The app keeps one window. Switching workspaces loads the other machine's Seismic in that window,
and the one you leave keeps running, its agents included. Phones and browsers do not use
workspaces: they connect to one Seismic through **Connect a phone**, as before.

## First start

On its first start the app asks **How do you want to use Seismic?**

- **On this machine**: agents run on this computer, with the coding tools installed here. Phones
  and other computers can connect to it later.
- **Remote connection**: Seismic already runs on another machine. The step shows **Your
  workspaces**, the ones the app knows already, and below them the form to connect another
  machine.

A remote machine whose Seismic has no project yet does not ask: it goes straight on to set itself
up. While another workspace is on the list, every setup step has **Exit setup** on the left of its
buttons. After you confirm, the window switches to this machine's workspace (or, from this
machine, to the first remote one), and the setup goes on where it was the next time you open it.

## What the other machine needs

1. Open Seismic there and go to **Configuration → Other devices**.
2. Turn on **Reachable from other devices** and choose how your network reaches it:
   - **Through Tailscale**: Tailscale runs on that machine, logged in, with HTTPS on in your
     tailnet. Seismic gives itself an HTTPS address there.
   - **At an address**: one of that machine's addresses, in a VPN or on the local network.
   - **Behind a proxy**: your own reverse proxy on that machine serves Seismic under host names
     you list in Seismic's settings file.
3. Make sure this machine reaches that address: the same tailnet, VPN or local network. Seismic
   does not go onto the open internet.
4. Choose **Connect a phone**. It shows a QR code, the address and a 6-digit code.

## Connect a workspace

Open the form with **New workspace** in the switcher, with **Remote connection** on the first
start, or on a Mac with **Workspace → New Workspace…**. Fill in:

- **Address or pairing link**: the address the other machine shows, such as
  `https://studio.tail1234.ts.net`. You can paste the pairing link from the QR code instead: it
  fills in the address and the code. Copy that link without opening it, since opening it pairs
  the device that opened it and uses up the code.
- **Code**: the 6 digits from **Connect a phone**.
- **Name (optional)**: what the switcher calls the workspace. Empty, it shows the machine's host
  name.

Choose **Connect**. The app checks that a Seismic answers at the address, pairs with the code and
opens the other machine's Seismic in the window, signed in. If the code is wrong, has expired or
was used, the form says so: let the other machine show a new one.

## Switch workspaces

The switcher heads the left menu on every page in the app, on remote workspaces too. It shows the
workspace you see, marked **this machine** or **remote**, and lists the others a click away, with
**New workspace** below them. Its cog opens the shown workspace's settings.

On a Mac the **Workspace** menu in the menu bar lists them as well: **Control–Command–1** opens
this machine, **Control–Command–2** through **Control–Command–9** the next eight workspaces in
menu order, and the menu marks the current one. On Windows and Linux the switcher is the way
between workspaces; closing the window there quits the app, while on a Mac it only hides it.

While the app checks that the workspace you picked answers, the window stays on the one you see.
If you pick another one meanwhile, your last pick wins. If you delete the workspace you picked
before it opens, the switch is cancelled and the window stays where it is.

Returning to a workspace brings back its last page and unsent drafts. When a draft attachment is
still uploading, the app asks first: **Switch after upload** keeps it in your draft, **Discard and
switch** cancels it, **Go back** keeps the current workspace open and the upload running. If
project settings have an unsaved draft, **Stay** keeps it open.

If this machine's server stops while you work in a remote workspace, you can keep working there.
Start it again to switch back.

## Manage workspaces

The list lives on this machine's Seismic, on its **Workspaces** page (the switcher's cog leads
there from every workspace). The cog beside a workspace opens its settings:

- **Name**: what the switcher calls it.
- **Address**: where the other machine answers. To move a workspace, change the address and
  **Pair again** with a code from the new address; the old address stays until pairing succeeds.
  Each address belongs to one workspace.
- **Pair again**: pair with a new code from **Connect a phone**, for example after this app was
  removed under **Other devices** on that machine.
- **Delete workspace**: takes the workspace off the list. That machine and its agents keep
  running. To unpair this app there too, remove it under **Other devices** on that machine.

This machine's workspace can be renamed but not deleted: the app starts and stops that Seismic
itself. A remote workspace's pages can list and switch workspaces but cannot change the list.

## When a workspace does not answer

When the selected workspace cannot be opened, the window shows **<workspace> is unresponsive**,
with the workspace's address and what happened below it, including when Seismic answers but its
page fails to load. **Try again** opens the page that failed and shows recovery again if it still
cannot load. After an interrupted pairing, it opens the last workspace page, or the workspace
home if you have yet to open a page. If Back returns to a maintenance page, **Try again** still
opens the page you originally asked for. **Switch workspace** lists the others.
**Recovery help**, beside **Try again**, opens this guide in your
browser. On a Mac, **File → Open in Browser** (**Shift–Command–B**) opens the workspace's address
in your browser.

If you go back to that screen after reconnecting, **Try again** checks the workspace again and
recovers unsent conversations, issue drafts and settings edits.

## After an update

The app reopens the selected workspace in its window, at its last page or at the screen above if
it is offline, and keeps unsent drafts of the workspaces you switched away from. A selected remote
workspace reopens even if this machine's server cannot start. If Seismic cannot save your work
for the restart, it defers the update; it also waits while you dictate or play a demo in the shown
workspace.

Seismic keeps a copy of a workspace list it cannot read as `app-desks.unreadable.json` in its home
directory; later copies get numbered names.

On macOS Big Sur the desktop app turns off microphone and camera capture: dictation needs macOS
Monterey or newer.
