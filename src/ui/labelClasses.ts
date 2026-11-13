// A card's labels and the pickers that set them (Tailwind on frost's tokens), for the parts several
// files build: the priority's flag (`card/labels.tsx`, and the card-link pills `cardMenu.tsx` builds
// as raw DOM), the picker's button and menu (the labels on the unfolded card, the "⋯" of a card and a
// plan in `canvases.tsx`). The class names before the utilities (`prio prio-high sugg bare`,
// `prio-btn set`, `prio-menu`, `lopt`) stay as hooks: other families' rules size and space them where
// they sit (the card faces, the card-link pill, the "⋯").

import type { Priority } from '../core/labels';

/** A priority's colour, rising from pencil grey to red; critical is white on red. */
const level: Record<Priority, string> = {
  trivial: 'text-planned-strong font-medium',
  low: 'text-question font-semibold',
  medium: 'text-in-pr-strong font-semibold',
  high: 'text-waiting-strong font-semibold',
  veryHigh: 'text-destructive font-semibold',
  critical: 'text-destructive-foreground bg-destructive font-semibold rounded-[3px]',
};

/**
 * A card's priority: a flag and its name, in its colour. `suggested` (Seismic's, not the owner's yet)
 * frames it in the dashed purple of a proposal; `bare`, the flag alone, as the smallest face shows it.
 */
export const prioClass = (priority: Priority, { suggested, bare }: { suggested?: boolean; bare?: boolean } = {}) => {
  const framed = priority === 'critical' || suggested;
  return [
    `prio prio-${priority}`,
    suggested && 'sugg',
    bare && 'bare',
    'inline-flex items-center gap-[3px] flex-none normal-case tracking-[.01em] [&_svg]:block [&_svg]:flex-none',
    level[priority],
    suggested && 'border border-dashed border-proposal rounded-[3px]',
    // the padding of a filled or framed mark; the flag alone is tighter
    framed && (bare ? 'p-[1px_3px] leading-none' : 'pt-0 pb-0 pr-[5px] pl-1'),
    suggested && !bare && 'leading-[15px]',
    bare && !framed && 'px-px',
  ]
    .filter(Boolean)
    .join(' ');
};

/** Where a picker stands: its button, the menu anchored to it. */
export const prioPickClass = 'prio-pick relative inline-flex text-[12px]';

/**
 * A picker's button: framed while nothing is picked; once set, the mark it shows is the button, a
 * framed one (critical, a chip, a suggestion) with the least padding around it.
 */
export const prioBtnClass = (set?: boolean) =>
  [
    set ? 'prio-btn set border-transparent has-[.prio-critical,.lchip,.prio.sugg]:p-px' : 'prio-btn border-border',
    'border border-solid bg-transparent py-px px-1.5 rounded-[8px] cursor-pointer leading-[18px] hover:border-border hover:bg-muted',
    '[&_.lchip]:text-[12px] [&_.lchip]:leading-4 [&_.prio.sugg]:leading-4',
  ].join(' ');

/** A picker's menu. */
export const prioMenuClass = 'prio-menu min-w-[140px] p-1 flex flex-col border border-solid border-glass-edge rounded-[12px]';

/** An option with an icon before its words (a complexity's bars, a canvas's icon). */
export const loptClass = 'lopt flex items-center gap-1.5 text-foreground [&_svg]:flex-none [&_svg]:text-foreground [&_b]:font-semibold';
