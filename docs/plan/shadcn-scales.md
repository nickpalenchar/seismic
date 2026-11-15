# Frost on shadcn's scales and Tailwind's palette

## Goal

The move onto shadcn/ui with Tailwind (done 2026-11-12) was pixel-faithful:
every old value came across as it was, as a Tailwind arbitrary value (`px-[13px]`, `text-[12.5px]`,
`rounded-[3px]`) or a hand-mixed colour, with no scale behind it. Bring that styling back to shadcn's own
scales and Tailwind's colour palette, so that the UI is built from a few sizes and one palette and new parts
fit without picking values of their own. Frost stays Seismic's identity: the glass, the gradient board, the
blur and the meaning of each state's colour. What stays custom is written one way: Tailwind and cva next to
the component, on tokens, with no one-off values. Shifts of about a pixel and slightly different hues are
accepted; the look changes in detail, not in character.

## Today

Audit of 2026-11-12, after W7 of the shadcn plan landed; counts from grep, may be off by a few. Each
workstream recounts what it touches.

- **Where styles live.** Every view is Tailwind on frost's tokens, with shared looks as class strings in
  `*Classes.ts` files beside the views (`cardClasses`, `card/faceClasses`, `configClasses`, `reviewClasses`,
  `ringClasses` …). `frost.css` (about 100 lines) holds frost's theme blocks (light and dark values), the
  board, its font and the keyframes; the state colours as `--c` on `.s-*` and `.p-state.*` are in `tailwind.css`'s
  components layer. `tailwind.css` maps shadcn's
  variables onto frost's names (`--foreground: var(--ink)`, `--muted`/`--accent`/`--secondary: var(--chip)`,
  `--border: var(--line)`) and registers the state and glass tokens. Preflight is on (headings keep the
  browser's sizes and weight, lists their markers).
- **Sizes.** About 1,250 arbitrary pixel values in `src/ui`, about 110 of them in `src/ui/components/`.
  Heaviest: `detail.tsx` 56, `parts.tsx` 52, `configClasses.ts` 38, `setup.tsx` 32, `card/faceClasses.ts` 30.
  - 27 distinct pixel font sizes from 9.5 to 31 px; the common ones `text-[13px]` 87×, `text-[12px]` 65×,
    `text-[12.5px]` 49×, `text-[11px]` 34×, `text-[14px]` and `text-[11.5px]` 27× each.
  - About 235 arbitrary radii, and paddings and gaps in odd pixels throughout.
  - The components drifted from stock shadcn: Button has its own paddings; Tabs spells its three looks out
    as `group-data-[variant=…]` classes on every trigger.
  - About 100 `border-0`/`border-solid` date from when preflight was off and can go.
- **Colours.**
  - The code uses frost's names rather than shadcn's: `text-ink` 138×, `bg-chip` 81×, `border-line` 80×,
    `bg-panel` 28×, `text-error` 24×, `text-warn` 20×.
  - The twelve state colours are hand-picked hex values for light and dark in `frost.css`; *reviewing*
    (#008c91) and *inPr* (#0b8b93) are nearly the same teal. Helpers around them (`--waiting-rgb`,
    `--state-text-ink`) mix tints by hand.
  - Tints are mixed per use: about 110 `color-mix()` in class strings (most in `cardClasses.ts`,
    `card/faceClasses.ts`, `detail.tsx`) and 12 in CSS; about 65 hex literals in `.ts`/`.tsx`
    (`reviewClasses.ts` 15, one in Button's `review-warning`); about 50 distinct hex and 40 `rgb[a]()` values
    in the stylesheets.

## Shape

**Colours, three layers**, all defined in one token file (`tailwind.css`, which takes frost's theme values
out of `frost.css` in the same change):

1. *Hues* from Tailwind's palette, in its oklch values. No hex, `rgb()` or `rgba()` literal is left outside
   the token file. The starting mapping (light step / dark step), which the worker adjusts after looking at
   contrast on glass, light and dark:

   | State | Light | Dark |
   |---|---|---|
   | working, primary | blue-600 | blue-400 |
   | waiting | orange-600 | orange-400 |
   | approved | green-600 | green-400 |
   | reviewing | teal-600 | teal-400 |
   | inPr | cyan-600 | cyan-400 |
   | proposal | violet-600 | violet-400 |
   | idea | rose-600 | rose-400 |
   | question | sky-700 | sky-300 |
   | asking | yellow-600 | yellow-400 |
   | restart | sky-500 | sky-300 |
   | planned | slate-400 | slate-400 |
   | live | slate-500 | slate-500 |
   | destructive (error) | red-700 | red-400 |
   | warning | amber-700 | amber-400 |

2. *Semantic tokens, shadcn's names only*: `background`, `foreground`, `card`, `popover`, `primary`,
   `secondary`, `muted`, `muted-foreground`, `accent`, `border`, `input`, `ring`, `destructive`, plus
   `success`, `warning`, `info`. Frost's aliases (`ink`, `chip`, `line`, `panel`, `error`, `warn`, `on-ink`)
   are renamed by codemod across `src/ui` and retired.
3. *State tokens*: each state has three steps, a solid fill, a subtle tint and text on the tint
   (`bg-waiting`, `bg-waiting-subtle`, `text-waiting-strong`), from the hue's -600 / -100 / -800 in light and
   -400 / -950 / -200 in dark. The per-element state colour (`--c` set by `.s-*`, read by faces, plans, edge
   chips and links) carries the three steps too, so a part tinted by "its" state needs no `color-mix()`.
   The hand-mixed tints in class strings go; a mix that is not a state's tint (a glass layer, a shadow)
   becomes a named token.

**Frost stays.** `--glass`, `--glass-edge`, `--glass-hi`, the board gradient, the blur and `frost.ts`'s
blur-while-moving keep their recipe. Their neutrals come from Tailwind's `slate`, the closest to frost's
blue-grey.

**Sizes.** A small token scale near shadcn's, in `tailwind.css`:
- type: `2xs` 11, `xs` 12, `sm` 13, `base` 14.5 (frost's root size), `lg` 18, `xl` 20, `2xl` 24, and one
  display size (30) for the splash and empty-project headings; each with its line height;
- radius: `xs` 2 for small marks and chips, shadcn's `sm`/`md`/`lg`/`xl`/`2xl`/`3xl` from `--radius` (today
  6/8/10/14/18/22), plus `full`;
- spacing: Tailwind's 4px steps (`--spacing: 4px` as today), half steps where a control needs them.

Every arbitrary value snaps to the nearest step, mostly by a codemod with a hand pass for what the codemod
can't judge (a size that sets a layout, a value computed at runtime). Components go back to stock shadcn
classes and keep only what they really add (`armed` and `suggested` on Button, glass on the layers). The
`*Classes.ts` strings become cva variants on components (a card face's state, a review finding's kind) where
a look has variants, or plain classes in the one view that uses them.

**Guard.** `tailwind.test.ts` fails on what this plan removes: hex, `rgb[a]()` and `color-mix()` outside the
token file and frost's aliases (from the colours workstream on), arbitrary font sizes and radii (from the
sizes workstreams on, first in `src/ui/components/`, then everywhere), and arbitrary spacing once the views
are done. Values that are not CSS colours (a colour drawn into a canvas or a generated image) are named in
the guard with the reason.

**Check.** Each workstream compares screenshots of every state (card faces, the state line, pills, badges,
findings) in light and dark, desktop and phone, frost on, before and after; `scripts/style-snapshot.ts`
shows which computed values moved, and the shifts are expected to be small, not zero. It measures the
blur-while-moving frame rate with `scripts/pan-fps.ts` against the same commit before, on one machine at the
same time (absolute values don't compare across runs: other workers' agents and scratch servers load the machine, a load average around 20 halved the frame rate once).

**Decisions** (owner, 2026-11-12). Tailwind and cva next to the component; no CSS-in-JS library. Sizes snap
to a small scale near shadcn's, shifts of about a pixel accepted. Colours become a standard palette close to
shadcn's that keeps frost's identity, with the hues from Tailwind's palette, which shadcn's themes are built
on; this replaces the 2026-11-09 "Radix's hues as they are" choice of the superseded Radix plan. Rejected:
Radix Colors, frost's own hues put on a scale, a CSS-in-JS library. The neutrals from `slate` are the plan
writer's call. It is a plan of its own rather than W9/W10 of the shadcn plan (as first sketched), since that
plan closed with W8 (2026-11-12).

## Workstreams

- [x] **W1:** Colour tokens. The token file: frost's theme values move from `frost.css` into `tailwind.css` as Tailwind palette hues (the table above, adjusted for contrast on glass), shadcn's semantic tokens plus `success`, `warning`, `info`, and the three steps per state, also on the per-element `--c`; frost's aliases renamed by codemod and retired; the hand-mixed `color-mix()`, hex and `rgba()` in class strings and CSS replaced by tokens; the colour guard in `tailwind.test.ts`; the frost decisions in [UI system](../design/ui-system.md) get the palette (chosen, why, rejected). Can run before or beside the shadcn plan's W8: the theme blocks it moves are then no longer W8's. M, one card.
- [x] **W2:** The scales, and the components back to stock shadcn. The type, radius and spacing scale in `tailwind.css`; `src/ui/components/` (about 110 values) snapped to it, Button and Tabs back to shadcn's classes with only Seismic's extras kept, Tabs' looks as cva variants; the size guard for `src/ui/components/`. No overlap with the views, so it can run beside W1. M.
- [x] **W3:** The views on the scales. A codemod snaps every arbitrary font size, radius, padding and gap in `src/ui` outside the components to the nearest step, then a hand pass (detail, parts, config and setup first: the heaviest); the size guard widened to all of `src/ui`. After W2; the ~100 `border-0`/`border-solid` that preflight made redundant go in the same pass. L; may split by family (card faces and the canvas, then detail and the sheets). Done 2026-11-14 in one pass: ties snap to the coarser step (3 and 5 px to 4), pill radii to `full`; widths, heights and offsets in the views stay arbitrary as layout, and the guard leaves them out there.
- [ ] **W4:** Shared looks as variants. The `*Classes.ts` strings become cva variants on components or plain classes in their one view, and the files go; the "Visual identity" decision gets the scales (chosen, why, rejected); this plan doc and its link in The canvas deleted. After W3. M.
