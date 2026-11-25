






import type { Priority } from '../core/labels';


const level: Record<Priority, string> = {
  trivial: 'text-planned-strong font-medium',
  low: 'text-question font-semibold',
  medium: 'text-in-pr-strong font-semibold',
  high: 'text-waiting-strong font-semibold',
  veryHigh: 'text-destructive font-semibold',
  critical: 'text-destructive-foreground bg-destructive font-semibold rounded-xs',
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
    'inline-flex items-center gap-1 flex-none normal-case tracking-[.01em] [&_svg]:block [&_svg]:flex-none',
    level[priority],
    suggested && 'border border-dashed border-proposal rounded-xs',
    
    framed && (bare ? 'py-px px-1 leading-none' : 'pt-0 pb-0 pr-1 pl-1'),
    suggested && !bare && 'leading-[15px]',
    bare && !framed && 'px-px',
  ]
    .filter(Boolean)
    .join(' ');
};


export const prioPickClass = 'prio-pick relative inline-flex text-xs';

/**
 * A picker's button: framed while nothing is picked; once set, the mark it shows is the button, a
 * framed one (critical, a chip, a suggestion) with the least padding around it.
 */
export const prioBtnClass = (set?: boolean) =>
  [
    set ? 'prio-btn set border-transparent has-[.prio-critical,.lchip,.prio.sugg]:p-px' : 'prio-btn border-border',
    'border bg-transparent py-px px-1.5 rounded-md cursor-pointer leading-[18px] hover:border-border hover:bg-muted',
    '[&_.lchip]:text-xs [&_.lchip]:leading-4 [&_.prio.sugg]:leading-4',
  ].join(' ');


export const prioMenuClass = 'prio-menu min-w-[140px] p-1 flex flex-col border border-glass-edge rounded-lg';


export const loptClass = 'lopt flex items-center gap-1.5 text-foreground [&_svg]:flex-none [&_svg]:text-foreground [&_b]:font-semibold';
