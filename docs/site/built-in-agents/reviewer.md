---
title: Reviewer
description: The optional independent agent that reviews a worker's changes.
sidebar:
  order: 2
---

The **reviewer** is an optional second agent. When it is turned on, a separate agent reviews the
work a [worker](/docs/built-in-agents/worker/) produced and flags any issues it finds.

## Handling findings

You decide what happens with each issue the reviewer raises:

- **Now:** the worker addresses it before the card lands.
- **As a follow-up:** the issue becomes separate work.
- **Not at all:** the issue is dismissed.
