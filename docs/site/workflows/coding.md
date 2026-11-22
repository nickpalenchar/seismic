---
title: Coding
description: The workflow where a worker reads a card's request and writes the changes in the project.
sidebar:
  order: 1
---

"Coding" happens whenever a [worker](/docs/built-in-agents/worker/) agent is assigned to a card. It is
the most basic and fundamental concept in Seismic's development flow.

## Happens when

You click "Start Agent" on a card, or "Submit items" on a code review that has items to fix.

## Goal

Read the request, determine the changes needed to fulfill it, and write those changes in the project.

The request is usually the description of the card the worker is assigned to. It can also be the
items to fix from a [code review](/docs/workflows/code-review/).
