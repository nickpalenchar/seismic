---
title: Code Review
description: The read-only workflow that assesses a worker's changes and raises flaws with a severity level.
sidebar:
  order: 2
---

A Code Review is a read-only workflow. It assesses the changes a [worker](/docs/built-in-agents/worker/)
made and raises any flaws it finds, each with a severity level.

## Happens when

- A [coding](/docs/workflows/coding/) workflow concludes, either from the initial work or after fixes
  from a previous code review are finished, and the card is configured for automatic code reviews.
- You click "Start Code Review" on a card whose work is complete.

## Goal

<!-- TODO: add goal -->

## Disputed items

A worker asked to fix an item it holds wrong disputes it instead, with its reasons. The item comes
back to you marked "Disputed", with the worker's reasons in a box inside it; later reviews leave it
alone, since the decision is yours. "Confirm and close" agrees with the worker: the box closes and
the item offers the usual "Fix it", "As a follow-up task" and "Ignore", with "Ignore" chosen.
"Reject and explain" asks, in the same box, why the item holds; once you confirm, the box closes the
same way, with "Fix it" chosen and your words as its context. Until you send, the item's badge says "Dispute confirmed" or "Dispute rejected". Your
choice goes out with your next Send, like the others on the Review tab.
