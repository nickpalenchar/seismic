---
title: Project Basics
description: How projects, canvases, cards and workers fit together in Seismic.
---

A **Project** is the unit Seismic keeps memory for. Everything you do in Seismic happens inside one.

## The menu

The menu holds the inbox, the agents' configuration, the open project's views and the settings. Its button
sits at the top left, beside the Seismic logo. On a wide window the menu is docked as a sidebar on
the left: the button hides it (a panel icon with an arrow pointing left) and shows it again (the
arrow pointing right). On a smaller window the button shows a menu icon and the menu drops down
under it.

From top to bottom it holds:

- **Inbox** and **Configure agents**: the agents, their **Rules** (how every agent works with
  you), code review rules and how well they performed.
- **Project**, named after the project that is open: its **Canvas**, **Table**, **Queue**,
  **Parked** and **Archive**. To switch to another project or add one, use the project's name at
  the top left of the project, or ⌘P / Ctrl+P. The project's own settings are behind the button at
  the top right.
- **Configure**: **Appearance** (light or dark, motion) opens within the menu; **Settings** opens
  Seismic's configuration, with **About Seismic** as its last section. **Settings → Project
  defaults** holds the choices every new project starts with; it does not change existing projects,
  and each project can override them in its own project settings. Below a line,
  **Controls: mouse and keys** and **Give Feedback**, which sends a wish or a bug to the makers of
  Seismic.

## Hints

Seismic shows first-time hints that teach its features, such as a tip under the chat with
Seismic. Close one with its × and it stays gone; others go once you have used what they point
to. **Settings → Hints** turns them all off or back on with **Enable first-time hints** (hints you
dismissed stay dismissed), and **Reset all hints** shows every one again. A dismissed hint stays
gone on every device that opens your Seismic; the on/off switch applies to the browser you use it
in. If Seismic cannot load which hints you have seen, none shows.

## Canvases

A project has at least one **canvas**, an infinite space where you lay out the work. Double click
(or tap, on mobile) anywhere on a canvas to create a card.

## Cards

Each **card** is a task. Describe what you want and the card gets its own worker.

- **Arrows** between cards set an order: one card comes before another. Agents can also infer
  arrow directions (dependencies) as cards are created, if you configure them to.
- **Groups** are for visual organization only.

## Workers

A worker is the agent assigned to a card. It does the task as a change in its own workspace, a
git worktree or a cloned repository depending on configuration, so workers run in parallel
without stepping on each other. Once work is finished and approved, workers coordinate landing it.

## Demos and review

When a worker finishes, it records a demo (a narrated video, or a page to look at) and hands the
card over. You can approve it or give feedback, which sends the worker back to work.

If an independent reviewer is turned on, a separate agent reviews the work and flags issues. You
choose whether the worker addresses them now, as a follow-up, or not at all.

## Next

Tell Seismic how a repository's app runs and which checks a change must pass in its
[repository settings](/docs/reference/settings/).
