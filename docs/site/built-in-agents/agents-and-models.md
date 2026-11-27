---
title: Agents and models
description: Choose the harness, model and effort each built-in agent runs on, for all projects or for one.
sidebar:
  order: 0
---

Seismic works through a few built-in agents, each with its own role:
[Seismic itself](/docs/built-in-agents/coordinator/) coordinates the work,
[workers](/docs/built-in-agents/worker/) build the tasks, and
[reviewers](/docs/built-in-agents/reviewer/) check a card's work before it lands. A few more run
in the background: exploration agents think ideas through with you, and small jobs write things
like card titles and the text of shared demos.

For each of these roles you choose three things:

- **Harness**: the coding tool the agent runs in, such as Claude Code, Codex or Antigravity. Only
  harnesses you have connected under **Settings → Harnesses** can be chosen.
- **Model**: one of the models that harness offers.
- **Effort**: how hard the model thinks, from low to maximum.

The defaults for every project are under **Settings → Agents and models**. Changes apply to new
sessions: agents already running keep the model they started with.

:::tip
Worker models can also be changed per task, by clicking the
<span style="display:inline-grid;place-items:center;width:1.5em;height:1.5em;border-radius:4px;background:#1a5cff;vertical-align:middle" aria-label="chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
chevron next to the **Start agent** button on a card. Pick a harness, model and effort there and
choose **Start with this choice**.
:::

## Overriding agents and models per project

A project can use its own harness, model and effort for any role, in place of the defaults. Fields
you leave open keep following **Settings → Agents and models**.

1. Open the project you want to set default models for.
2. Click the
   <span style="display:inline-grid;place-items:center;width:1.5em;height:1.5em;vertical-align:middle" aria-label="sliders icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg></span>
   **Project settings** button in the top right of the canvas.
3. Click **Agents and models**.
4. Under **Models**, choose the harness, model and effort for each role you want to change.

The next agents to start in that project take the new choice; agents already running keep theirs.
