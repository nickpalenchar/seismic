# Reusable UI components on Radix

## Goal

Seismic's UI has no component library: every control is hand-built, styled by its container's CSS,
with its own copy of outside-click, Esc and positioning code. Replace them with a small set of
reusable components in `src/ui/components/`, each wrapping a Radix Primitive (or, where no
behaviour is needed, plain markup) and styled with our own CSS and theme tokens, until no bespoke
control is left. Frost, dark mode and the phone view look as they do today; what changes for the
owner is consistent keyboard behaviour (arrow keys in groups and tabs, focus kept inside dialogs and
returned on close) and fewer one-off quirks.

## Inventory

The audit of `src/ui/` (2026-11-09). Counts come from grep and may be off by a few; each workstream
starts by recounting its family. The inventory shrinks as workstreams land: a workstream removes its
family's section when it is done.

**Stack.** React 19 bundled by Bun; plain CSS in `styles.css` (~3,200 lines) with `frost.css` on
top, both driven by CSS variables (`--card`, `--ink`, `--chip`, the status colours), light and dark
via `data-theme`. Icons from `lucide-react`, the only UI dependency: no Radix, no positioning
library, no class-name helper. `src/ui/components/` holds the toast and the buttons (W2).

**Shared plumbing today.**

- `useMenuClose` (`queue.tsx`) is the de-facto dismiss hook: capture-phase outside `pointerdown`,
  optional Esc, and the `obeya:close-bar-menus` event. Used by the archive drop-down, the canvas
  drawer, CardMore, ShareTags, the project picker, the left menu, snooze, StartAgent and the label
  pickers. `parts.tsx` (workstations), `usage.tsx` and `cardSearch.tsx` carry their own copies.
- Esc is routed centrally by one capture `keydown` handler in `App.tsx`: open overlays "take the
  keys" in order, it skips when `.lightbox`, `.demo-zoom`, `.nav-menu`, `.diff-view`,
  `.start-agent-menu` or `.card-more-menu` is in the DOM, and honours `[data-esc]` on fields. About
  fifteen components add their own Esc listeners besides.
- No focus trap utility: only the Performance dialog traps focus and returns it to its opener.
- Positioning is by hand: CardMore flips up/down, the label pickers shift left at the edge, snooze
  repositions on scroll.
- Settings dialogs share blocks: `config.tsx` exports `Field`, `ThemeBlock`, `LanguageBlock`,
  `SuggestField`, `CodeReviewField` and others that `prefs.tsx` and `projectSettings.tsx` reuse, so
  a control migrated inside them covers all three dialogs.

**Phone.** `phone.tsx` is its own root but reuses the desktop components (card detail, Agents tabs,
stage chips, inbox list, chats, Koordinator composer, card faces, usage pill, toasts), so migrating
a component migrates the phone along. Phone-only controls: the back and new buttons, the talk pill,
the project `<select>` (the phone's counterpart of the project picker) and the draggable talk panel.
Phone CSS gives a few shared controls a larger touch target (the buttons in `.ph-view .actions`, say).

### Tabs — Radix Tabs

- With roles: Agents sheet Queue | All | Parked | Activity (with counts; also on the phone), card
  results Video/Document | files | Review | Diff (`files.tsx`), the change list in Diff, Setup
  Required | Recommended, Projects → repository tabs (a `.seg`), the canvas tab strip at the bottom
  right (with its hover drawer).
- Without roles: the Configuration left nav (`aria-current`, sections and one entry per project) and
  the Preferences nav (appearance | rules | about) — vertical Tabs.

### Menu — Radix DropdownMenu

- `role=menu`: the left menu (`prefs.tsx`, with separators), CardMore "⋯" on the card head and on
  plan cards on the canvas (portal that follows the camera, closes when it moves; nested confirm),
  the snooze menu (presets plus a date-time form; card actions and the conversation's snooze line),
  the four label pickers (priority, category, sub-category, complexity; `menuitemradio`; card head
  and plan sheet).
- Without a role: the project picker (`nav.tsx`, a list of links, "New project" and the pin; the same
  list docks as the pinned navigation), the archive drop-down (search, list, full-screen toggle),
  ShareTags "+" (tag chips to pick), the StartAgent chevron (a panel of three selects).

### Popover — Radix Popover

- Click-pinned or hover panels with interactive content: the workstations pill (`role=dialog`,
  "Take" and per-workstation menus, own outside-click and Esc), the usage pill, the status pills'
  hover tips (restart, update, source and old Bun: `.tip.why` holds card links, `.tip.risk` the button's
  warning; pure CSS hover, not keyboard reachable), the StartAgent options panel, the snooze date-time form, the canvas drawer
  (hover-opened list with rename, icon, reorder, remove).

### Select — Radix Select

- 30 native `<select>`s: Preferences (language ×2), Configuration → Agents (harness, model, effort
  per role), Demos (voice, language, voice kind), Cloudflare account, project site, keep frames,
  Devices (address), Project settings (three agent overrides), StartAgent (harness, model, effort),
  Koordinator (chat model, rule target, reshare count), Feedback log filters (3), Performance
  (period, filter), Setup (cloud preset, language), card detail (the workstream to build on), the
  phone's project switcher.
- Styled only inside the settings dialogs (`appearance:none` with a drawn arrow) and the StartAgent
  menu; elsewhere unstyled.

### Dialog — Radix Dialog and AlertDialog

| Dialog | Where | Today |
|---|---|---|
| Configuration | left menu | always mounted, toggled by class; Esc from App; backdrop pointerdown; no trap |
| Preferences | left menu | as Configuration |
| Performance | left menu | the only one with a focus trap and focus return |
| Connect a phone | Configuration → Devices | Esc from App; no trap |
| Help (controls) and the new-card hint | left menu, "New task" | no `aria-modal`; autofocus on the hint |
| Report a wish | left menu | no `aria-modal` |
| Merge picker | card head | own Esc and arrow keys (a combobox inside) |
| Canvas new / edit | canvas strip | own Esc on the form |
| Confirms (7) | card detail: unsent replies, approve during review, start parked, open questions; stop-to-park; delete an old name | one shared look (`.review-approval-*`) copied seven times, each with its own Esc and autofocus on "Back" |

- Dialog-like without a role: Setup (own Esc, backdrop), the Diff view, the screenshot lightbox,
  the demo video zoom, the artifact image (an injected close button).
- Non-modal side panels — the right-dock sheets (`Docked`, `DockShell`), the chats drawer, the
  phone's talk panel, the full-page view — keep their own shell: they are not dialogs and get no
  focus trap.

### Combobox and listbox — shared hook, no Radix

- The `/` card search (`role=combobox` with a listbox), the composer's `/` skill menu (listbox under
  a textarea), the card-link menu in the contentEditable task field (`cardMenu.tsx`), the merge
  picker (input plus arrow keys, no ARIA). Radix has no combobox; each implements arrows, Enter,
  Esc and `data-esc` by hand.

### Chips, pills and badges — shared components, no Radix

- Bar pills (`.pill`, about 90 selectors): `kpill` toggles with `.on`, `aria-expanded` and a count
  (talk, project settings, agents, inbox, archive, the phone's talk), plain pills (search, new card,
  help, project switch), status-bar pills (restart and its states, workstations, usage).
- Count badges in about five contexts, each with its own CSS: `.n` (with `err`, `unread`, `prop`),
  `.count` (Agents tabs, stage chips), canvas waiting counts, the project list's waits.
- Card badges: `.badge` pins on card faces and plan cards (`pulse`, `failed`, `replied`).
- Chips: stage filter chips, label chips (`lchip-*`, `sugg`, `none`), share tag chips (with ×,
  `pick`), file chips on answers, review finding status (`f-pill`), card-link pills (`smart-link`,
  `cm-pill`, the latter built as raw DOM inside the contentEditable).

### Form fields and smaller pieces

- Text inputs and textareas are styled by container (`:is(#config,#prefs,#project-settings) input`,
  `#wish .w-issue`, `textarea.p-title`, `.c-path` …): about 51 in Configuration, 9 in Setup, a few
  elsewhere. Number inputs in Configuration; `datetime-local` in snooze.
- Collapsibles: native `<details>` (config, detail, setup), line-clamp "more/less", the folding
  conversation column, finding folds with `aria-expanded`, `cl-more`, the merge toggle, performance
  rows, plan folds on the canvas.
- Progress: the usage meter and the reshare bar, neither with `role=progressbar`.

### Stays bespoke

Not controls a library models, so they keep their own code: the radial right-click rings (canvas
and groups), the selection-anchored cite button, the lasso's "group" button, the dock's resize grip,
the camera, the card faces themselves, the toast (already shared).

## Shape

**One component per family** in `src/ui/components/`, one file each (`button.tsx`, `switch.tsx`,
`menu.tsx` …), wrapping the Radix part with an API modelled on shadcn/ui's (its source is the
reference; its Tailwind classes are not used): small, composable parts (`Menu`, `MenuTrigger`,
`MenuItem` …), a `variant` and `size` prop where the family has variants, `className` passed
through for layout only, `asChild` where a link or label must be the element.

**Styling.** Each component's CSS lives in one block of its own (one file per component imported by
`styles.css`, or one marked section — W1 decides and the rest follow), styled by data attributes
Radix sets (`[data-state=open]`, `[data-disabled]`) and by the existing tokens only; `frost.css`
reshapes the shared classes as it does today. Contextual overrides (`.actions .btn` and its fifty
siblings) are what each workstream removes: layout belongs to the container (gap, alignment), look
to the component.

**Layers and Esc.** Radix layers dismiss themselves on Esc and outside click, and portals put them
under `body`. App's central Esc handler must leave an open Radix layer alone instead of closing the
card behind it: W1 replaces its DOM class checks with one rule (an open layer, e.g.
`[data-radix-popper-content-wrapper]` or a dialog with `data-state=open`, takes Esc first) so each
later workstream only deletes its class from the old list. Portals go into a container inside the
app root so `data-theme` and frost apply.

**Behaviour changes are accepted** where Radix is the standard: arrow keys and roving focus in
groups, tabs and menus; typeahead in menus and selects; focus trapped in modal dialogs and returned
to the opener. Behaviour the owner relies on is kept and checked in each demo: Esc order (the
innermost layer first, then the card), menus closing when the canvas moves, the settings dialogs
keeping unsent input while closed (Radix `forceMount`), push-to-talk on Space not stolen by a
focused control, a first tap acting while the phone keyboard is open.

## Workstreams

- [x] **W1:** Foundations. Add `@radix-ui/react-*` packages as each workstream needs them (or the single `radix-ui` package — pick one and say why); a portal container inside the app root; the component conventions above written as a short header comment in `src/ui/components/` (API shape, CSS block, tokens, data-attribute styling); App's Esc handler made layer-aware as described in Shape; the CLAUDE.md line that new UI uses the components in `src/ui/components/` and adds one there rather than a bespoke control; rewrite the decision "The look is frost, laid over upstream's stylesheet" in [The canvas](../design/the-canvas.md) so the rejected component library becomes the chosen Radix Primitives (owner, 2026-11-09: the fork no longer merges upstream; rejected shadcn/ui with Tailwind and Kibo UI as a second styling system, Base UI for its smaller set of mature parts). Proves the setup with the first component, `VisuallyHidden` or `Slot`, used once. S.
- [x] **W2:** Button, IconButton, CloseButton, LinkButton. One `Button` (`variant`: default, primary, danger, code-review, review-warning, link; `size`: default, small; `suggested`, `armed` as props), `IconButton` (icon plus required label, which W6 turns into a tooltip), `CloseButton` replacing the twelve ✕ kinds, the StartAgent split button as a composition. Migrate every `btn`, `button.link` and close button; delete the old classes and contextual overrides, moving spacing to containers. Largest by count (detail and config); may land in two cards, settings first, then card detail and the rest. M.
- [x] **W3:** Switch and Checkbox. Radix Switch for the 14 toggles, Radix Checkbox for the plain checkboxes (export, suggest, artifact checks); their labels (`c-check`, `share-check` …) become one `Field`-style label pattern. S.
- [x] **W4:** Segmented control and radio groups. `SegmentedControl` on Radix ToggleGroup (single and multiple) for every `.seg`, the chats scope, files result mode, Performance views and the stage chips' group; Radix RadioGroup for the native radios and the canvas icon grid; the feedback stars stay a bespoke rating on RadioGroup with their hover preview. Arrow keys replace one tab stop per option. M. Landed: `components/segmented.tsx` (`SegmentedControl`, `ToggleGroup`/`ToggleItem`) and `components/radio.tsx` (`RadioGroup`, `RadioOption`, `Radio`). The tablists that wear `.seg` (Agents tabs, repository tabs) stay until W5, which removes the `.seg` rules.
- [ ] **W5:** Tabs. Radix Tabs for the Agents sheet (desktop and phone), card results, the Diff change list, Setup pages, the repository tabs and the canvas strip (keeping its hover drawer and first-tap-opens on touch); vertical Tabs for the Configuration and Preferences navs, keeping each section's address and unsent input. M.
- [x] **W6:** Tooltip. Radix Tooltip with one provider and delay; IconButton shows its label as one; the Configuration info tip and the agents tip moved onto it; the status pills' tips hold links, so they moved to W8's inventory with the other interactive tips. Replace `title=` on icon-only buttons; leave it where it names truncated text. Check touch: a tooltip must not block the first tap. S–M.
- [ ] **W7:** Menu. Radix DropdownMenu for the left menu, CardMore (on the card head and on canvas plan cards, still closing when the camera moves), the four label pickers (radio items), ShareTags and the project picker (links as items, the pin kept; the pinned navigation keeps sharing its list). `useMenuClose` loses these callers; their classes leave App's Esc list. M.
- [ ] **W8:** Popover. Radix Popover for the workstations and usage pills, the status pills' interactive tips, the StartAgent panel, the snooze menu's date-time form and the archive drop-down; the canvas drawer keeps opening on hover (Popover with controlled open). Delete `useMenuClose`, the `obeya:close-bar-menus` event if nothing else needs it, and the hand-copied outside-click code in parts and usage. M.
- [ ] **W9:** Select. Radix Select for the 30 native selects, styled like the settings selects today; the StartAgent panel's three selects inside a popover; the phone's project switcher decides between Radix Select and keeping the native picker on touch (the native sheet is often better on a phone: check in the Android emulator and keep what works better). S–M.
- [ ] **W10:** Dialog. Radix Dialog for Configuration, Preferences, Performance, Connect a phone, Help, the new-card hint, Report a wish, the merge picker and the canvas dialog (focus trap and return everywhere; `forceMount` where input must survive closing); Radix AlertDialog as one `ConfirmDialog` for the seven confirms; Setup, the Diff view and the lightbox move onto Dialog where their behaviour fits, else stay and are listed under "Stays bespoke". Their entries leave App's Esc list. The longest workstream after W2: may split into settings dialogs and the rest. M–L.
- [ ] **W11:** Combobox. No Radix part exists: one shared `useListbox` hook and `Listbox` component (active option, arrows, Enter, Esc with `data-esc`, ARIA wiring) under the card search, the composer's skill menu, the card-link menu and the merge picker. Rejected for now: adding cmdk or Ariakit, a second behaviour library beside Radix for four uses, two of which sit in a textarea and a contentEditable those libraries don't own. M.
- [ ] **W12:** Chips, pills, badges and fields. Shared `Pill` (bar and toggle pills with count), `Badge` (count, card pin), `Chip` (filter, label, tag with remove), `TextField` and `TextArea` (one look, not by container), and Radix Collapsible where a fold has a trigger and a region (finding folds, merge toggle, performance rows; native `<details>` may stay). The card-link pill built as raw DOM shares the `Chip` class. M.
- [ ] **W13:** Close-out. A check that fails on a bespoke control (a test grepping `src/ui` for the old classes and roles outside `src/ui/components/`: `className="btn`, `role="switch"`, `.seg`, `<select`, `role="dialog"`, `role="menu"`, `useMenuClose`); the leftover CSS deleted; [The canvas](../design/the-canvas.md) "Visual identity" describes the component set as behaviour (keyboard, Esc order, focus) where a rebuild needs it; this plan doc and its link in that chapter's header deleted. S.

## Boundaries

W1 goes first. W2 comes next because every later component composes it (dialog footers, menu
triggers, popover contents). W3 to W6 are independent of one another and can run in parallel after
W2. W7 and W8 both delete `useMenuClose` callers and edit App's Esc list, so they land one after
another; W9 needs W8 for the StartAgent panel; W10 after W7 because menus open confirms. W11 and W12
are independent once W2 has landed. W13 is last.

Every workstream adds its components, migrates every use in its family (desktop and phone), deletes
the old CSS and contextual overrides, removes its family from the Inventory above, and shows
screenshots of desktop and phone in light and dark (frost on) in its demo, with the keyboard path
(Tab, arrows, Esc) for the controls it touched. `config.tsx` and `detail.tsx` are touched by almost
every workstream: workers rebase often and keep their changes to the controls, not the layout
around them.

Risks: visual regressions in frost and dark mode (checked per workstream by screenshots); the phone
layout, where Radix portals and the on-screen keyboard meet (checked in the Android emulator for
W7–W10); focus moving where today's hand-built code left it, most of all Space for push-to-talk
while a control has focus.

Decisions (owner, 2026-11-09): Radix Primitives, unstyled, each wrapped in our own component and
styled with the existing CSS tokens; shadcn/ui's source as the API reference only. Rejected:
shadcn/ui with Tailwind (and Kibo UI on top of it), a second styling system that would mean mapping
frost onto shadcn's variables; Base UI, with a smaller set of mature parts. The audit is this
plan's first section rather than a separate doc. The order of the workstreams, the Combobox without
a new library and the phone's select are the plan writer's calls, the workers' to adjust.
