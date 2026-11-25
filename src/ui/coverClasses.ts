




import { cn } from 'cn';


const base =
  'cover relative! flex! flex-col! w-[280px]! max-w-full! mt-2! pt-2.5! px-3! pb-2! text-foreground! no-underline! ' +
  '[&_.kind]:text-2xs! [&_.ttl]:text-base! [&_.ttl]:line-clamp-2! [&_.meta]:text-sm! [&_.meta]:line-clamp-1! ' +
  
  '[&_.state]:relative! [&_.state]:inset-auto! [&_.state]:mt-1.5! [&_.state]:text-xs! [&_[data-slot=badge][data-variant=pin]]:hidden!';


const gone = 'gone cursor-default! [box-shadow:none]! opacity-70! hover:[transform:none]! before:bg-border!';


const own = 'own cursor-default! pt-3! [--dep:var(--approved)] [--dep-fg:var(--approved-foreground)] [box-shadow:0_0_0_2.5px_var(--approved),var(--shadow)]! hover:[transform:none]!';

/** The cover's class beside the card's own (`card`): `own` for the queued card itself in its chain, `gone` for a card no longer on the project. */
export const coverClass = (card: string, how: { own?: boolean; gone?: boolean } = {}) => cn(card, base, how.own && own, how.gone && gone);
