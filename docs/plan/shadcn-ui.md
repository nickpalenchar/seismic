# shadcn/ui with Tailwind, in frost

## Goal

Seismic's UI is hand-written CSS (`styles.css`, ~3,200 lines, frost's look and tokens merged into it) and our own
components in `src/ui/components/`. Adopt shadcn/ui with Tailwind v4 as the basis instead: its basic
components (Button, Input, Select, Dialog …), its higher-level ones (Sheet, Command, Accordion,
Sonner …) and AI Elements (Conversation, Message, Prompt Input) for the conversations. They replace
the hand-written CSS and the components we wrote on Radix, until no bespoke control and no
container-scoped control styling is left. Seismic keeps the **frost** look: the shadcn parts wear
frost's glass, gradient board and state colours, in light and dark, on desktop and phone. What the
owner gets is one consistent, maintained component set, a conversation view with scroll-to-latest and
a standard message layout, and new views built from ready-made parts.

This plan takes over the unfinished work of the Radix plan (Popover, Select, Dialog, chips and fields,
close-out; stopped 2026-11-10), which landed Button, Switch, Checkbox, Segmented, Radio, Tabs,
Tooltip, Menu and Listbox in `src/ui/components/`. Those stay in use and are regenerated from shadcn
in W2.

## Today

- **Components.** `src/ui/components/` holds the toast, `Listbox`, `Badge` (with the card pin and tag chip), `Input` and `Textarea`, `Collapsible`, `Progress` and the basic parts regenerated
  from shadcn in W2: `Button` (with `armed` and `suggested`; `IconButton` and `CloseButton` compose it
  with `Tooltip`), `Switch`, `Checkbox` and its label, `SegmentedControl` on `ToggleGroup`,
  `RadioGroup`, `Tabs`, `Tooltip` and `Menu` (shadcn's DropdownMenu). They are styled by Tailwind
  classes in the component on frost's tokens; containers reach them for layout through `data-slot`
  (`[data-slot=button]`), never for their look. `Listbox` keeps its block in `components/listbox.css`
  until W5. The header of `components/ui.tsx` states the conventions.
- **Styling.** `styles.css`, one stylesheet on one set of CSS variables (`--card`, `--ink`, `--chip`, the
  state colours `--working`, `--waiting`, `--approved` …), light and dark via `data-theme`. Frost
  turns cards, sheets, dialogs and menus into frosted glass over a gradient board; `frost.ts` drops the
  blur while the canvas moves, which keeps ~100 cards at 60 fps. Tailwind and shadcn's tokens are in
  (W1, below); the one generated part so far is `Badge`, on Configuration's problem counts.
- **Conversations.** AI Elements parts in `src/ui/components/ai/`, ours once copied: `Conversation`
  (use-stick-to-bottom, with the scroll-to-latest button, `said` taking the box to its end and `start`
  opening it at a message), `Message` (the turn, its head, the reply and take-back actions) and
  `PromptInput` (the frame, text, tools, Send and the hint line). `message.tsx`'s `Msg` is the adapter
  every turn goes through (card, chats, Koordinator); `composer.tsx` keeps the voice, screenshots, skill
  menu and card links and builds on `PromptInput`. Message kinds (question, unread, at work, paused, actions), markdown Body, reply quotes, question history, steps, background work, notes and answer-file chips use Tailwind in their shared parts and adapters (W7 conversation slice). No tool-call
  or reasoning streams are shown.
- **What is still hand-built** (the inventory of the Radix plan, audit of 2026-11-09, counts from grep
  and may be off by a few; each workstream recounts its family and the family leaves this list when it
  is done):
  - *Popovers* are done (W3's Popover card): `components/popover.tsx`, with `useHoverOpen` for those
    that also open on hover (the workstations pill, the status pills' tips) and a controlled one for
    the canvas drawer. The archive, a full-page view now, closes on a click beside it through `FullPage`.
  - *Selects* are done (W3's Select card): `components/select.tsx`, one `Select` with `SelectItem`
    children (the empty string works as a value). The phone's project switcher stays a native
    `<select>` laid invisibly over its button: a finger gets the system picker, which Radix's list
    would only imitate; the shared parts on the phone use `Select`.
  - *Dialogs* are done (W3's Dialog card): `components/dialog.tsx` with `Dialog`, `DialogContent`
    (`keepMounted` for Configuration and Preferences, whose drafts and fetched views must survive
    closing: their children stay mounted outside Radix's content and move into it on opening) and
    `ConfirmDialog` (Radix AlertDialog) for the seven confirms. Configuration, Preferences,
    Performance, Connect a phone, Help, Report a wish, the merge picker, the canvas dialog and the
    Diff view and Setup's overlay are on it. Setup stays a full page on first run; from Configuration
    it is a nested dialog so focus and dismissal belong to the front window. Staying our own:
    the screenshot lightbox, the demo video zoom and the artifact image (their open and close
    animate from the thumbnail they were taken from).
  - *Chips, pills, badges*: the file chip. The count badges, card pins, label and tag chips and the
    card-link pill (JSX and the composer's raw DOM through `badgeClass`) are `Badge` variants; the bars'
    pills are `Pill` and `PillButton` (`components/pill.tsx`, W7's first card).
  - *The bars* are done (W7's first card): the top bar, the floating row under it, the status bar and
    their pills (restart, update, source, old Bun, workstations, usage), whom the microphone speaks to,
    the left menu (dropped down and docked) and the phone's talk button and project picker are Tailwind
    in their components. `tailwind.css` adds the variants they need (`resizing:`, `reduced:` for the
    reduced-motion setting, `ph-landscape:` for the turned phone) and `frost-bar`, the frosted strip of
    both bars; `a { color: inherit }` moved into the base layer, so a utility's colour on a link wins.
    The steps of `barFit.ts` are read through named groups (`group-data-[fit~='1']/bar:hidden`).
  - *The card detail* is done (W7's card-detail card): the open card's pane (`frost-pane` in
    `tailwind.css`, solid while it unfolds), the dim behind it, its sticky row of decisions (`panel-foot`),
    title, state line, text field, the split into result and conversation, the conversation's box, the
    framed boxes (questions with their options, brief, queue, pull request with its review, superseded,
    failed), the demo player with zoom, chapters and versions, sharing and page tags, the result tabs,
    change list and file viewers, screenshots (thumbnails, strip, lightbox with marking), the sign-in row
    and the snooze and start-at lines. The shared looks several files build are `cardClasses.ts`; the
    `phone:` and `no-hover:` variants cover the phone's overrides. Still on `styles.css` beside it, for the
    families they belong to: the per-state colours of the state line (shared with the card faces), the
    queue on the card and in the bar (`qlist`, `q-chain`, `q-place`), the merge view, `Fold` (its class
    is shared with other folds), the plan sheet, and the text primitives `.hint`, `.p-kind`, `.p-error`.
    A trap the comparison found: `[font:inherit]` beside `text-[…]` resets the size whatever their order
    in the class string; buttons inherit the font from the base layer already.
  - *Esc*: `App.tsx` routes Esc centrally and skips when `.lightbox`, `.demo-zoom` or `.diff-view`
    is in the DOM (and for an open layer); about fifteen components add their own Esc listeners.
- **Phone.** `phone.tsx` is its own root but reuses the desktop components, so a migrated component
  migrates the phone with it. Phone-only: back and new buttons, the talk pill, the project switcher,
  the draggable talk panel; phone CSS enlarges touch targets for a few shared controls.

## Shape

**Build** (done in W1). Tailwind v4 through Bun's Tailwind plugin (`bun-plugin-tailwind`): in the
production build of `bun start` (`src/server/ui.ts`), in `--hot` through `bunfig.toml`'s
`[serve.static]` plugins, and in `scripts/build.ts`, which compiles with `Bun.build` for it.
`src/ui/tailwind.css` is linked by `index.html` beside `styles.css`, never imported by it: the plugin
compiles (and its optimizer rewrites) the whole file that imports Tailwind, which turned the finished
cards' color-mix into solid green when the stylesheet imported it. Tailwind's scale counts in pixels
(`--spacing: 4px`, `text-xs`/`text-sm` in px), since frost's root font is 14.5px and the rem scale would
shrink every part by a tenth. `styles.css` declares the cascade layers first and keeps its element
reset (`button, input, textarea { font: inherit; color: inherit }`) in the `base` layer, so a part's
own colour and size win over it. `components.json` for the shadcn CLI (the
Radix build, matching the `radix-ui` package in use; `@/*` is `src/ui/*` in `tsconfig.json`). The
CLI writes `cn` from shadcn's own `cn` package (a compiled clsx + tailwind-merge), so that is the
helper; `src/ui/lib/utils.ts` re-exports it where `components.json`'s `utils` alias points, for registry
parts (AI Elements) that import it from there, and `components/registry.test.ts` checks that every alias
resolves; `tw-animate-css` if the generated parts need it. shadcn parts go into `src/ui/components/` (replacing
our same-named files), AI Elements into `src/ui/components/ai/`. Generated files are ours once
copied: edited freely, with frost's needs written into them rather than patched over by overrides.

**Tokens.** shadcn's variables (`--background`, `--foreground`, `--card`, `--primary`, `--muted`,
`--accent`, `--border`, `--ring`, `--radius` …) become the one token set, with values taken from frost
for light and dark: `--background` the board, `--card` the glass, `--primary` frost's blue. Seismic's
state colours (`--working`, `--waiting`, `--approved` …) and frost's glass tokens (`--glass`,
`--glass-edge`, the blur) are registered with Tailwind (`@theme inline`) as extra tokens, so
`bg-waiting` and `bg-glass` exist. `data-theme` keeps switching light and dark (Tailwind's `dark:`
variant is pointed at it, else the system's dark), and the blur-while-moving behaviour of `frost.ts`
stays as it is. The mapping table is the header of `tailwind.css`, whose variables refer to frost's
(`--background: var(--bg)`), so the theme blocks of `styles.css` stay the one place for values while
the old rules still read them; W8 moves the values into the token file and leaves of the old CSS only
what is not a token (the gradient board, the glass recipe). Frost's `--muted` (secondary text) was
renamed `--muted-foreground`, shadcn's name for it, since shadcn's `--muted` is a fill.

**Coexistence.** Tailwind's preflight resets every element, which would shift the hand-styled UI.
So Tailwind comes in with preflight off and `styles.css` still loaded; utilities are layered
(`@layer`) so that the old stylesheet and the new parts do not fight by specificity. Each workstream
converts its views and deletes their CSS; preflight comes on in the last workstream, when `styles.css`
is gone. Until then, a part that needs a reset (a `button` or `input` shadcn assumes is bare) carries
it itself. Tailwind generates a utility for every word in `src/ui` that names one, and the utility
applies to any element with that class: W1 renamed the old classes that shared a utility's name
(`.hidden`, `.fixed`, `.inline`, `.ring`, `.table`, `.grow`, `.visible`), and `tailwind.test.ts`
fails when a class the old stylesheets style is a utility.

**Baseline** (W1, 2026-11-10, for W7's comparison). Bundle (all chunks, minified): JS 12.46 MB →
12.49 MB (2.71 → 2.72 MB gzip; the `cn` package and cva), CSS 445 KB → 462 KB (199 → 202 KB gzip).
Frame rate while panning, 100 cards at the overview zoom, 2560×1353, headless Chromium without a GPU
(`moving` set, so no blur): 34.5 fps before and after Tailwind, measured by wheel events each frame
for 4 s, three runs each.

**AI Elements.** Only the parts with something to show. *Conversation* replaces `stickToEnd` and adds
scroll-to-latest. *Message* is used as is. *Prompt Input* gets our voice (push-to-talk), screenshots,
skill menu and card links grafted on. A small adapter maps our message items to the components' props;
the Vercel AI SDK is not adopted. *Reasoning*, *Tool* and *Chain of Thought* wait until Seismic shows
agents' tool calls.

**Layers and Esc.** Radix layers dismiss themselves on Esc and outside click and portal under `body`:
into a container inside the app root, so `data-theme` and frost apply. App's central Esc handler
leaves an open layer alone (one rule: an open layer, e.g. a dialog or popper content with
`data-state=open`, takes Esc first) instead of the class list; each workstream deletes its family's
class from the old list, and `useMenuClose` and the `obeya:close-bar-menus` event go when their last
caller does.

**Behaviour kept.** Esc order (`layerOpen`: the innermost layer first, then the card); menus closing
when the canvas moves (`closeBarMenus`); Space for push-to-talk not stolen by a focused control; the
first tap acting while the phone keyboard is open; unsent input surviving closed dialogs
(`forceMount`); the phone view following the desktop one. Accepted changes where Radix is the
standard: roving focus and arrow keys in groups, tabs and menus, typeahead, focus trapped in modal
dialogs and returned to the opener.

**Stays our own.** The canvas itself: card faces' layout, the radial right-click rings, the cite
button anchored to a selection, the lasso's "group" button, the camera, the dock's resize grip. They
are restyled with Tailwind on the same tokens but not replaced by library parts. Non-modal side
panels (the chats drawer, the phone's talk panel, the full-page view) keep their own shell; the dock
sheets move onto Sheet only as far as Sheet's non-modal mode fits (W4).

## Workstreams

Each workstream converts every use in its family (desktop and phone), deletes the CSS and contextual
overrides it replaces, removes its family from "Today", and shows desktop and phone in light and dark
(frost on) in its demo, with the keyboard path (Tab, arrows, Esc) for the controls it touched.
`config.tsx` and `detail.tsx` are touched by almost every workstream: workers rebase often and keep
their changes to the controls, not the layout around them.

- [x] **W1:** Foundations and tokens. `tailwindcss` and `bun-plugin-tailwind` wired into `bun start`, `--hot` and `scripts/build.ts` (Tailwind with preflight off, utilities layered under the old CSS); `components.json`, `cn()`, the `@` alias if the CLI needs it; shadcn's variables defined from frost's values in light and dark, with Seismic's state and glass tokens registered as extra Tailwind tokens and `dark:` bound to `data-theme`; the portal container; App's Esc handler made layer-aware. Proved by one generated part (e.g. `Badge`) used once with no visible change to the rest of the UI. Tests still pass and the bundle size and the blur-while-moving frame rate are measured once as a baseline. M.
- [x] **W2:** Basic components regenerated from shadcn. Button, Switch, Checkbox, ToggleGroup (the segmented control), RadioGroup, Tabs, Tooltip and DropdownMenu replace our wrappers' CSS and markup. They keep our extras: `armed` and `suggested` on Button, tabs with manual activation for the canvas strip and change list, closing on `closeBarMenus`, the left menu docked-versus-dropdown context, `layerOpen`. IconButton and CloseButton stay as thin compositions. The `.btn`, `.seg`, `.pill`-toggle and related contextual overrides for these are deleted. L (may land in two cards: Button first, since every later part composes it, then the rest).
- [x] **W3:** The stopped families as shadcn parts. Popover (workstations and usage pills, the status pills' interactive tips, the StartAgent panel, the snooze date-time form, the archive drop-down; the canvas drawer keeps opening on hover through controlled open); Select (the ~30 native selects, with the phone's project switcher deciding between Select and the native picker on touch, checked in the Android emulator); Dialog and AlertDialog (Configuration, Preferences, Performance, Connect a phone, Help and the new-card hint, Report a wish, the merge picker, the canvas dialog; `forceMount` where input must survive closing; one `ConfirmDialog` for the seven confirms; Setup, the Diff view and the lightbox move onto Dialog where their behaviour fits, the rest is listed as staying our own). Delete `useMenuClose` and the hand-copied outside-click code. L; split into three cards: Popover, Select, Dialog (all done; Setup stays a full page on first run and uses Dialog over Configuration; the lightbox, the demo zoom and the artifact image stay our own, the phone's project switcher stays native).
- [x] **W4:** Fields, badges and folds. Input and Textarea (one look, not by container: `#config input`, `#wish .w-issue`, `textarea.p-title` and their kin go), Badge for count badges and card pins, chips (filter, label, tag with remove; the raw-DOM card-link pill shares the chip classes), Collapsible and Accordion for folds with a trigger and a region (finding folds, merge toggle, performance rows, config and detail `<details>`), Progress for the usage meter and reshare bar. M–L; Input/Textarea and Badge/chips may land apart. Accordion was not needed (no fold group opens one at a time); the bar pills and the file chip stay for W7.
- [x] **W5:** Higher-level parts. Sheet for the right-dock sheets (non-modal where the canvas stays usable beside it, keeping the dock's own resize grip), Command for the card finder (taking over its own outside-click close) and merge picker (replaces `Listbox` where the input is a plain field; the composer's skill menu and card-link menu sit in a textarea/contentEditable and keep `Listbox` unless Command fits there), Sonner behind the existing toast store so every toast still goes through it. M–L. The dock sheets are a non-modal Sheet that Esc, outside presses and focus never dismiss (the dock owns those); the finder is Command in a Popover; toasts go to Sonner as custom elements inside `#acks`, above the rate and notification prompts.
- [x] **W6:** AI Elements in the conversations. The message-item adapter; Conversation replaces `stickToEnd` (with scroll-to-latest and the unsent/unread behaviour intact); Message for turns in cards, chats and the Koordinator; Prompt Input as the one composer with voice, screenshots, skill menu and card links grafted on, working the same on every card kind and on the phone (keyboard open, first tap acts, Space for push-to-talk). Attachments and unsent input keep surviving close and reload. L; split into Conversation and Message, then Prompt Input. Done as one card. The 2026-11-11 styling decision follows stock AI Elements on frost tokens: full-width text above a tools footer with round Send, plain agent turns, quiet owner bubbles, and no tinted conversation panel.
- [ ] **W7:** The remaining views and the canvas chrome. Every view still on `styles.css` after W2–W6 (card detail, plan cards and card faces' chrome, the top and status bars, the inbox, usage, feedback log, the phone's own controls, toasts) converted to Tailwind on the shared tokens, family by family; the canvas elements that stay our own restyled the same way. Frost's glass checked in dark mode on every part, and the blur-while-moving frame rate against W1's baseline. L; as many cards as there are views (about three). The first card did the bars (see "Today"). The conversation slice migrated message kinds, markdown Body, quotes, question history, steps/background work, notes and answer-file chips; code copying and replying were checked in the browser. The card-detail card did the detail shell, live questions and result/media/attachment viewers (see "Today"). Still to do: card faces, plan cards and the canvas's own elements (rings, lasso, minimap, canvas tabs, the push-to-talk row); the inbox, "Needs you", the Agents sheet, the feedback log, Performance, Configuration and Setup; the queue (on the card and in the bar), the merge view and the plan sheet; the rest of the phone view and the toasts; then the frame rate against W1's baseline.
- [ ] **W8:** Close-out. Preflight on, `styles.css` gone and `frost.css` reduced to the board and glass recipe; a check that fails on a bespoke control (a test grepping `src/ui` outside `src/ui/components/` for `className="btn`, `role="switch"`, `<select`, `role="dialog"`, `role="menu"`, `useMenuClose`); the docs updated as the next paragraph says; this plan doc and its link in The canvas deleted. S–M.

## Boundaries

W1 goes first and W2's Button before everything else, since every later part composes it. W3, W4
and W5 are independent once W2 has landed, except that W3's Popover precedes W5's Sheet and Command
(same positioning and Esc plumbing) and the Dialog card precedes the `ConfirmDialog` users in W4.
W6 needs W2 (Button, Tooltip, Menu) and W3's Popover; it can run beside W4 and W5. W7 starts after
W2 for the views that need only basic parts and waits on the others for the rest. W8 is last. Two
styling systems coexist from W1 to W8, so each workstream deletes the CSS of what it converts in the
same change: a view is never half Tailwind, half old CSS.

Docs, done by the workstream they belong to: W1 rewrites the decision "The look is frost, on our own
stylesheet and Radix Primitives" in [The canvas](../design/the-canvas.md) (chosen: shadcn/ui with
Tailwind in frost, 2026-11-10; rejected: our own CSS on Radix Primitives, shadcn's neutral look, the
2026-11-09 "no Tailwind" choice and why it was reversed), the header of `components/ui.tsx` and the CLAUDE.md line "New UI uses
the components in `src/ui/components/` …" (now: shadcn parts with Tailwind on frost's tokens, AI
Elements for conversations, new parts added through the shadcn CLI); W8 describes the component set in
"Visual identity" as behaviour (keyboard, Esc order, focus) where a rebuild needs it.

Risks: visual regressions while two styling systems coexist (screenshots per workstream); the
preflight switch at the end (W8 turns it on only when nothing depends on the old reset; W7 runs with
the rest of the UI already reset-safe); frost's glass on shadcn parts in dark mode (checked per
part, not only per view); frame rate with the blur on many Tailwind-styled cards; the phone layout,
where portals and the on-screen keyboard meet (checked in the Android emulator for W3 and W6); focus
moving where today's code left it, most of all Space for push-to-talk while a control has focus.

Decisions (owner, 2026-11-10): shadcn/ui with Tailwind, adopted wholesale, reversing the
2026-11-09 "no Tailwind" decision. Rejected: porting shadcn's behaviour into our CSS, Tailwind only in
the conversations, and shadcn's own neutral look on our CSS. Frost stays: its tokens feed shadcn's
variables. The Radix plan's open workstreams are built directly as shadcn parts here, not first on our
CSS. Preflight scoping, the exact token mapping and where workstreams split are the plan writer's
calls, the workers' to adjust.
