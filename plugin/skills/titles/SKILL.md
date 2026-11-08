---
name: titles
description: Write a short, precise title for an Seismic card from its task text and screenshots. Use when asked to name an untitled card or suggest a task title.
---

# Naming a card

Make the task recognizable on the project from its title alone. Use the language requested by the caller (the task's language when none is given) and
keep the concrete role, component, action or symptom that distinguishes it from other work.
Base the title on the task text and screenshots; use only details they support.

Choose the format that best expresses the task:

- A user's capability or workflow: **As <role> I should <action>**.
  Example: "As a reviewer I should compare demo versions".
  Use this when the user's role helps explain who needs the capability.
- Something broken: **<component> - <something that is not working>**.
  Example: "Export - CSV download is empty".
  Name the observed problem, keeping a condition such as "after reload" when it matters.
- A new component behaviour: **<component> should <new action>**.
  Example: "Search should filter cards by label".
  Name what the component should do from the user's point of view.

These are title formats, not input templates: read ordinary prose, rough notes and screenshots
for their meaning, then choose the closest fit. Use natural equivalents in the requested language.
When the task supplies neither a role nor a component, a concise action title such as
"Document the release process" is enough. For a task with several parts, name their shared goal.

Aim for about 70 characters, keeping the meaning clear. Return a single bare title line, with
sentence capitalization and without a trailing full stop.
