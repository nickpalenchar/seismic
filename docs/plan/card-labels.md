# Built-in card labels: category, complexity, priority

## Goal

Give every card built-in labels beside its priority: a category with a sub-category, and a
complexity of 1, 2, 3, 5, 8, 13 or 21. Where the owner leaves a label empty, Seismic suggests one in the
short session that already names a card, and marks it as its suggestion until the owner touches it.
Which labels Seismic may suggest is a toggle per project, and new projects take their toggles from
"Project defaults" in the configuration dialog. Like priority, the labels are the owner's: stored in
this Seismic, never in plan docs, and not told to agents.

## Shape

- **Fixed lists**, built in, the same for every repository (not a repository setting):
  - Category: Frontend, Backend, Data Migration, Docs, Tooling.
  - Sub-category: Refactor, New feature, Bug fix, Configuration.
  - A card has at most one category and one sub-category; a sub-category can be set without a
    category and the other way round.
- **Complexity**: 1, 2, 3, 5, 8, 13, 21 (Fibonacci), shown as numbers without descriptions in
  the picker, tooltips and suggestion scale (owner feedback on W2, 2026-11-04).
- **Priority** stays as it is (six levels, a label only); it joins the suggestion and its toggle.
- **Suggested labels**: Seismic fills only labels that are empty and never overwrites one the owner
  set. Each label it fills carries a "suggested" mark, drawn with the same dashed border and colour as a proposal card. Any
  owner action on that label (picking the same value, another one, or "None") clears the mark;
  "None" leaves the label empty and stops Seismic from suggesting it again for that card.
- **Suggestion styling**: the chip uses a proposal card's dashed border and colour; the card's own
  frame and fill still show its state (owner feedback on W2, 2026-11-04).
- **When Seismic suggests**: in the naming session of the "Small jobs" group, one call that
  returns the title and the labels together, when a card without a title is closed or started; for a
  card that already has a title (typed, a proposal, a workstream), in one short session of the same
  group when it starts. A card whose labels are all set, or whose project has every toggle off, runs
  no session for them.
- **"Add to CLAUDE.md"** gets category Docs and sub-category Configuration from Seismic itself when
  the card is made, marked as suggested like any other suggestion.
- **Project setting "Seismic suggests"**: toggles for Category (with its sub-category), Complexity
  and Priority, all on by default; a label added later brings its own toggle.
- **"Project defaults"** in the Configuration dialog (beside General): the same toggles, copied into
  a project when it is created; changing them later leaves existing projects alone. Every project
  setting has a default there, and a test fails when one is added without.

## Workstreams

- [ ] **W1:** Labels in the data and the API. Add category, sub-category and complexity to the card
  record next to priority, each with its "suggested" mark, stored in this Seismic like priority (never
  in plan docs), and the built-in lists and complexity descriptions in one shared place for server,
  UI and skill. Setting a label through the API clears its mark; a "suggest" write fills only empty,
  never-cleared labels and sets the mark. Old cards read as having no labels. Agents' prompts and
  tools stay without the labels. Tests for the writes, the marks and the never-overwrite rule.
- [x] **W2:** Pickers and chips on the card. Done (2026-11-04): `src/ui/labels.tsx` draws the face's
  priority flag and chips (complexity as rising bars and its number) and the unfolded card's four
  pickers; the complexity list shows the seven Fibonacci values without descriptions. A
  suggested label has the proposal's dashed border and colour; any
  pick, the same value included, sends the PATCH that makes it the owner's. A project's head shows
  its labels on a separate line below its title and actions, above the workstreams.
- [ ] **W3:** The suggestion. A plugin skill that judges category, sub-category, complexity and
  priority from a card's title, text and screenshots, with the lists and the complexity scale in it.
  Hook it into the naming session (one call returns the title and the labels) and, for a card that
  already has a title, into one short session at its start; only labels that are empty and whose
  project toggle is on are asked for, and none at all when nothing is left. A failed or slow session
  leaves the labels empty and never holds up the start. Tested against the fake runtime: fills only
  empty labels, respects the toggles, keeps an owner's pick made meanwhile, one call per card.
- [x] **W4:** Project toggles and Project defaults. Done (2026-11-05): a project's `suggest` in
  `projects.json` holds the toggles, shown as "Seismic suggests" on its page; the project hands them
  to the Koordinator's `suggests` option, read at each suggestion, so a saved change applies to the
  next one. Project defaults (`projectDefaults` in Seismic's `settings.json`) are copied into a project
  when `Config.save` creates it; the rule and the test are in Repositories and configuration
  (Project defaults).
- [x] **W5:** "Add to CLAUDE.md" is labelled. The card the Koordinator makes for rules of a
  CLAUDE.md gets category Docs and sub-category Configuration when it is made, as set labels rather
  than suggestions since Seismic makes the card itself (owner, 2026-11-05), regardless of the toggles
  and without a session, so the owner can tell it apart on the project.
- [ ] **W6:** Design docs. Move what passes the rebuild test into the chapters: the labels and the
  suggested state into The project (beside Priorities), the toggles and Project defaults with the
  sync rule into Repositories and configuration (the configuration dialog), the suggestion into the
  naming text under Creating cards, the stored fields into Data; decisions with their dates
  (Fibonacci steps and owner-only labels by the owner, suggestion borders matching proposal cards); then
  remove this plan doc.

## Boundaries

W1 comes first; W2, W3 and W4 build on it and can land in any order (W3 reads W4's toggles and
treats a project without them as all on). W5 needs only W1. W6 closes the project. The lists are
fixed: no editing per repository or project for now. The labels change neither the queue's order nor
what starts first, and agents are not told of them. The Seismic site's documentation of the
complexity scale comes later, outside this plan. Risks to watch in W3: the latency and cost of the
extra session at start (kept to one short call, skipped when nothing is left to suggest).
