---
title: Project Basics
description: How projects, canvases, cards and workers fit together in Seismic.
---

A **Project** is the unit Seismic keeps memory for. Everything you do in Seismic happens inside one.

## The menu

The menu holds the inbox, your projects, the agents' configuration and the settings. Its button
sits at the top left, beside the Seismic logo. On a wide window the menu is docked as a sidebar on
the left: the button hides it (a panel icon with an arrow pointing left) and shows it again (the
arrow pointing right). On a smaller window the button shows a menu icon and the menu drops down
under it.

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
