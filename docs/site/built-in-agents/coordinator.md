---
title: Seismic (Coordinator)
description: The special agent that coordinates work.
sidebar:
  order: 3
---

Every project has a special agent, a coordinator, which is simply referred to as **Seismic** itself. Unlike other agents, Seismic is read-only, and there is only ever one instance of it per project.

Seismic is in charge of creating other agents and assigning them tasks, most often as a [worker](/docs/built-in-agents/worker/) or a [reviewer](/docs/built-in-agents/reviewer/) on a card.

## What it does

- **Takes your commands.** What you tell Seismic is read by the agent, with a short window to undo.
- **Creates and schedules cards.**
- **Decides when a card may start.** A card whose changes are likely to conflict on merge with work in progress is queued instead of started. Sharing a file is not enough to count as a conflict.
- **Flags possible duplicates.** Unfinished cards that appear to ask for the same outcome are called out.
- **Manages workspaces.** It runs the pool of clones and worktrees that each [worker](/docs/built-in-agents/worker/) gets, on this machine or another one reached over SSH.
- **Keeps your preferences.** Rules about how agents work with you are learned from your answers, or stated outright, and shared by every agent. A learned rule stays a proposal until you accept it. All of them are listed under **Configure agents › Rules** in the menu.

A [worker](/docs/built-in-agents/worker/) with a question asks you directly. Seismic does not answer on your behalf.

## Recommended Models

While any model with logic could attempt to be a coordinator, the following generally produce quality results.

- Claude Opus
- Claude Sonnet
- GPT Codex Astra
- GPT Codex Sol
- GPT Codex Terra
