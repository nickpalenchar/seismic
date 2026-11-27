---
title: Model feedback
description: Rate the agents' work after you approve it, and compare how harnesses, models and effort levels do in your projects.
sidebar:
  label: Model feedback (beta)
---

Model feedback lets you rate an agent's work after you approve it, and compare those ratings by
the harness, model and effort that did the work. It is in beta and off until you turn it on.

## Turning it on

Each project decides for itself: open the project's settings, then **Model feedback**, and turn on
**Enable model feedback**. Under **Configuration → Project defaults**, the same switch sets what a
project created from then on starts with; projects that already exist keep their own.

Turning it off stops the prompts and takes the dashboards out of the menu. Ratings you already gave
are kept, and show again once it is on.

## Rating the work

With model feedback on, approving a card asks how well the agent did: 1 to 5 stars (Poor, Fair,
Okay, Good, Excellent) and an optional comment. Seismic saves your answer with the harness, model
and effort of the session that did the work. A card worked on by more than one configuration is not
credited to any single one of them.

Rating is never in the way: **Skip** leaves it, approval and landing go on either way, and the card
keeps the stars, so you can rate it or change your rating later. Contributors' pull requests and
prototypes are not asked about.

## The dashboards

With model feedback on in the project you are looking at, the menu's **Configure agents** page has two more entries:

- **Performance** compares your ratings by model and effort: how they spread over the five stars,
  each rating on its own, or the average over time. Filter by project, repository, plan and period.
  Fewer than a handful of ratings are marked as too few to compare.
- **Feedback log** lists every response, the newest first, with its card, plan, repository and
  configuration. Filter it by harness, model, effort and rating, and group it by configuration,
  plan, repository, project, week or month.

Both cover every project's ratings. The ratings are your judgement of single tasks, not a
benchmark: how hard a task was and what kind it was count too.
