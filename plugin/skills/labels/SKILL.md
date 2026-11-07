---
name: labels
description: Judge a card's labels on Seismic (category, sub-category, complexity, priority) from its title, text and screenshots, on Seismic's fixed lists and complexity scale. Use when asked to label, classify or size a card or task, or names this skill.
---

# Judging a card's labels

A card on Seismic is a task for a coding agent: a title, a text and perhaps screenshots. Its labels
tell the owner at a glance what kind of work it is. Judge only the labels you are asked for, each
from the card alone, and give a value for every one of them: a best guess beats none. Use exactly
the names below.

## Category

What part of the software the card is about; the one where most of its work lies.

- Frontend: what the user sees and touches (pages, components, styles, the phone view).
- Backend: servers, APIs, background jobs, agents and the logic behind the UI.
- Data Migration: stored data changes shape (tables, columns, a migration, moving data).
- Docs: documentation, plan docs, READMEs, instructions for agents.
- Tooling: build, tests, scripts, CI, releases, developer tools.

## Sub-category

What kind of change the card asks for.

- Refactor: the same behaviour in better shape (moving, renaming, simplifying code).
- New feature: something the software could not do before.
- Bug fix: something that does not work as it should.
- Configuration: settings, rules, defaults, permissions, dependencies.

## Complexity

How big the work is, on Fibonacci steps. Judge what the change needs, not how long the text is.

- 1
- 2
- 3
- 5
- 8
- 13
- 21

## Priority

How urgent the card is. Most cards are Medium; go higher only where the card says or shows that
something is broken, blocks work or loses data, and lower where it calls itself cosmetic or a nicety.

- Trivial: cosmetic, whenever there is time.
- Low: a nicety, nothing waits for it.
- Medium: ordinary work.
- High: something important is missing or annoying in daily use.
- Very high: blocks work or affects many users.
- Critical: something is broken, unsafe or loses data now.
