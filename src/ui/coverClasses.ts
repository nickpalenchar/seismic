// A card's compact cover outside the project (Tailwind on frost's tokens): in a conversation, the card an
// action of Seismic's made (made.tsx), and on a queued card, the chain it waits in (detail.tsx). The cover is
// a card face (`cardClass`, card/faceClasses.ts), whose utilities set the same properties on the same elements:
// what the cover changes of them carries `!` so it wins over them. `cover` stays as a hook before the utilities.

import { cn } from 'cn';

/** The cover: narrower than a card on the project, its title and text cut shorter, its state line under them; no pin. */
const base =
  'cover relative! flex! flex-col! w-[280px]! max-w-full! mt-[7px]! pt-[10px]! px-3! pb-[9px]! text-foreground! no-underline! ' +
  '[&_.kind]:text-[11px]! [&_.ttl]:text-[15px]! [&_.ttl]:line-clamp-2! [&_.meta]:text-[12.5px]! [&_.meta]:line-clamp-1! ' +
  // relative, so the moving line of a card at work stays under its state line, inside the cover
  '[&_.state]:relative! [&_.state]:inset-auto! [&_.state]:mt-1.5! [&_.state]:text-[11.5px]! [&_[data-slot=badge][data-variant=pin]]:hidden!';

/** A card gone from the project: its title, not a link. */
const gone = 'gone cursor-default! [box-shadow:none]! opacity-70! hover:[transform:none]! before:bg-border!';

/** In the chain a queued card waits in, the card itself: ringed green as on the project, its title only, not a link. */
const own = 'own cursor-default! pt-[13px]! [--dep:var(--approved)] [box-shadow:0_0_0_2.5px_var(--approved),var(--shadow)]! hover:[transform:none]!';

/** The cover's class beside the card's own (`card`): `own` for the queued card itself in its chain, `gone` for a card no longer on the project. */
export const coverClass = (card: string, how: { own?: boolean; gone?: boolean } = {}) => cn(card, base, how.own && own, how.gone && gone);
