# UI system

How Seismic's UI is built and the rules every screen follows. Unlike the rest of the design docs,
this chapter names parts, libraries and tokens: they are the system. The conventions inside a
component (cva, `cn`, `data-slot`, portals) are the header of `src/ui/components/ui.tsx`; the
tokens and what each means are the header of `src/ui/tailwind.css`.

## Order of preference

When a screen needs a control, take the first of these that does the job:

1. **A shadcn/ui part**, added with the CLI (`bunx --bun shadcn@latest add <part>`, configured by
   `components.json`) into `src/ui/components/`. Once copied it is ours: edit it freely, with
   frost's needs written into it rather than patched over from outside.
2. **A proven library already in use**: AI Elements for conversations (`components/ai/`), cmdk for
   command lists, Lucide for every icon (devicons for brand logos), Shiki for code, sonner for toasts, TanStack Table under
   data tables, Radix Primitives under the shadcn parts. A new dependency only where none of these covers the need.
3. **Tailwind and cva next to the component**, on the tokens of `tailwind.css` (`bg-primary`,
   `text-muted-foreground`, `bg-waiting-subtle`): no one-off pixel values or colours, no inline
   `style={{}}` for looks. A tint over glass is Tailwind's opacity (`bg-waiting/10`), never a
   hand-mixed colour; no hex or `rgb()` outside the token file (a test holds this).
4. **frost's own CSS** (`frost.css` and the few shared classes in `tailwind.css`): the glass, the
   gradient board, the state colours as `--c`, keyframes and the font. It is the only bespoke
   stylesheet and grows only for what Tailwind cannot say.

## Components, not class strings

Screens are built from React components in `src/ui/components/` (and the feature folders' own
components built on them), not from class strings handed around between files. A look used in two
places becomes a component or a cva variant; layout (gap, alignment, margin) belongs to the
container. A bespoke control is built only where no part exists, and then as a component in the
same style. UI text comes from `src/ui/strings.ts`, never a literal.

## Frost, Seismic's look

- **Glass panes over a cool board.** The board is a soft gradient with faint washes of blue, pink
  and mint under a faint dot grid; cards, the bar, the open card, sheets and dialogs are frosted
  glass with large soft corners, a thin bright edge and a diffuse shadow. Menus and tooltips are
  solid panes with the same edge. Light and dark, following the system until the owner picks;
  dark is smoked glass on a night board.
- **Glass gives way while the canvas moves.** During a pan, zoom or flight, and zoomed far out,
  cards drop the blur and take a solid tint that keeps their resting colour, so a pan never
  changes a card's colour; blur on every card costs too many frames. Reduced motion removes the
  blur everywhere.
- **Each state has a colour**, carried as a solid fill, a subtle tint and strong text on that tint,
  in both modes:
  - *planned* slate grey; *working* blue (also the primary colour);
  - *waiting* for the owner orange, the loudest colour, used for every count of what waits;
  - *approved* green; *reviewing* teal; *in PR* cyan; *live* and *done* faded slate;
  - *proposal* violet, pencilled in (dashed, no glass); *idea* rose;
  - an agent *asking* the owner a question yellow; a Question card and the highlight of a link
    under the pointer sky (*question*);
  - *destructive* red, *warning* amber.
- **A card needing the owner** gets an orange frame, a soft glow and a pulsing pin ("!", "!!" in red
  when its worker failed, "?" in yellow for a question). Group colours show only in territories and
  the minimap, never on cards.
- **Contrast**: marks at least 3:1 against glass, state text at least 4.5:1, in both modes, measured
  by `frost.test.ts`.
- **Type and icons**: Inter, self-hosted; the system monospace for code; Lucide icons only, never
  typographic stand-ins (▾, ✕). The one exception is a brand: a harness (Claude Code, Codex,
  Antigravity) is shown by its own logo from `@dev.icons/react` (devicons.io), never a drawn
  stand-in, since Lucide has no brand marks (2026-11-19; first in the usage pills, which show each
  limit as its logo and percentage without a meter).

## Rules every screen follows

- **Keyboard**: every menu, popover, dialog and trigger works from the keyboard. Space and Enter
  activate it (Space never starts push-to-talk on it), it has a keyboard path to open it, and closing
  it leaves focus where the user expects.
- **Toggle or checkbox**: a single on/off setting is a toggle switch; checkboxes only where several
  options of a set can be picked.
- **No coloured accent bars**: no coloured vertical bar down either side of anything, list items,
  entries and chat messages included; emphasis comes from a tint, a full outline or ring, or bolder
  text.
- **Links** are blue as well as underlined.
- **Space**: dialogs and text fields use the space the screen offers (the owner works on a tall
  monitor) instead of staying small with a scrollbar of their own; never two scrollbars side by side.
- **Rare actions stay out of the way**: shown only where they apply, behind hover or an overflow
  menu. A button's label says what it does to someone who doesn't know the use case yet.
- **Discoverable**: every new feature and shortcut gets a way for first-time users to find it, a
  visible icon or a hint that shows until it has been used once. A button that appears on hover over
  what it acts on needs no more; a tooltip or a documented key alone is not enough.
- **Undo where it matters**: a button that is easy to hit by accident and sets a lot in motion gets
  an undo; what is easy to reverse afterwards takes effect at once, without an undo window.
- **Nothing is lost**: whatever the owner entered on a card but has not sent (text, pasted
  screenshots, picked options, comments) survives closing the card, switching projects and a reload,
  for every input on the card, not only the text field.
- **What the owner is looking at is not flagged**: a message arriving in an open conversation gets
  no notification or unread marker, and an answered question no longer shows as open.
- **No command line**: where a message suggests a step (pushing `main` first, say), the UI offers it
  as an action right there, or the message doesn't mention it.
- **Shared interactions are built once**: what several kinds of card share (answering questions with
  comments and one Send button, the conversation history, starting while the agent still works)
  lives in shared code and works the same on each; no card kind gets its own variant.
- **The phone** stays as simple as possible: not every desktop view belongs on it (the workstations
  list stays desktop-only). What it shows follows the desktop: same controls, icons, button states
  and card layout, departing only where the small screen requires. A tap on a button while the
  keyboard is open does what the button does on the first tap, never just closing the keyboard.
  Its pages scroll only up and down: what comes out wider than the screen is clipped, never a
  sideways pan (decided 2026-11-19, after the Needs you page could slide sideways).
- **Polish before handover**: look closely at screenshots of new UI and fix what is off (text
  vertically centred with neighbouring buttons, enough padding to the edges of its block, controls
  such as a remove × where the eye expects them).

## Decisions

- **Frost on shadcn/ui with Tailwind** (2026-11-05, 2026-11-10): one token file, shadcn's parts on
  Radix, AI Elements for conversations, glass kept on every card with the blur dropped during motion.
  Rejected: an own stylesheet on Radix, shadcn's neutral look, a Tailwind prefix, Base UI, frost as a
  layer over upstream CSS.
- **Colours are Tailwind's palette on shadcn's semantic tokens** (2026-11-12): neutrals from
  `slate`, three steps per state. Rejected: Radix Colors, a hue scale of frost's own, CSS-in-JS.
- **frost's class names never share a name with a Tailwind utility** (`hidden`, `fixed`, `ring`),
  or the utility applies to them too.
- **The project settings sheet is a list of sections, each pushed in as a view of its own**
  (2026-11-14): full-width rows with an icon each, Allowed commands first (a red count while
  commands wait for trust), "Archive project" at the foot; Back and Esc return to the list;
  per-repository views have a switcher of the project's repositories. Every change saves at once, a
  repository's into its own entry of the configuration; what restarts a repository's agents (where
  they work, clones, slots, hosts) waits for an inline "Save and restart agents". Rejected: one long
  scroll, and the Configuration dialog's draft with a Save button. Configuration's project page
  still shows the same fields until they are taken out of it.
- **Data tables are shadcn's Table part on @tanstack/react-table (v8)** (2026-11-17), as shadcn's
  data-table pattern builds them: the library holds the column model, header sort toggles and
  column visibility; the rows' order and filters are plain functions of ours (`table/rows.ts`,
  `manualSorting`), so that enumerations sort by their own order and stay unit-tested. Rejected: a
  hand-built table, and TanStack's own sorting and filtering (alphabetical enumerations, empty
  values not last in both directions).
- **The view over the canvas is in the address as `?view=`** (2026-11-17), only `table` so far:
  switching replaces the address rather than adding a history step, as switching canvases does;
  a card's address keeps it, and an unknown value is dropped in place. Parked may join it later.
- **A card's result tabs (Video, Diff, files) each take their own height** (2026-11-17), with
  one floor: while a tab switched to still loads (a placeholder marked `aria-busy`), it is as tall
  as the one left, up to what the card shows of the tabs, so the card does not shrink and grow
  back; once loaded, the floor goes. Rejected: a floor at the tallest tab
  seen; after a long diff it left the video above a screen of empty space.
- **Tab on the canvas** (2026-11-20): from the project itself (nothing focused, or a focus a click
  left) Tab opens the next card that needs the owner; from a control the keyboard reached, and
  whenever nothing waits, it moves the focus on as anywhere: through the plans (the title opens
  one), the card faces (Enter or Space opens one, and the focus comes back to it when it folds;
  the camera brings one reached outside the view in), the bars, the canvas tabs and the views.
  Shift+Tab from the project goes into those controls from the end. An unfolded card takes the focus
  itself rather than its close button, whose tooltip took the first Esc and which Space pressed.
  The connection dots stay out of the Tab order: an arrow follows the pointer.
- **Phone settings and Needs you share one history step**: switching between them replaces that
  step; closing returns to the project. Pages covering the project make its controls inert.
- **Clone values parked while choosing worktrees belong to the repository draft**, rather than
  its mounted view. They survive section and repository switches, and are omitted from saves.
- **Esc in a docked sheet's inner view** goes back to its list: the docked sheet's Radix layer
  prevents Esc's default and the page's key handler listens in the capture phase, so the view
  marks itself `data-esc-back` and the page leaves Esc there to it.
