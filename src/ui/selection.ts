// The cards the owner has marked on the canvas (Shift + click, Shift + lasso), to move them together
// or put them into a group at once. A workstream counts as its plan, as in the lasso: it moves
// only inside its plan.

import type { Item } from '../core/types';

type Pos = { x: number; y: number };

/** What marking `i` marks: the card, or a workstream's plan. */
export const markable = (i: Pick<Item, 'id' | 'parent'>) => i.parent ?? i.id;

/** The selection with `id` taken in, or out when it was in. */
export const toggle = (sel: string[], id: string) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);

/** The selection with `ids` added (a lasso adds to what is marked, as Shift does elsewhere). */
export const addAll = (sel: string[], ids: string[]) => [...sel, ...ids.filter((id) => !sel.includes(id))];

/** The marked cards that move along when the owner drags `id`: the others of the selection, if `id` is in it. */
export const movesWith = (sel: string[], id: string) => (sel.includes(id) ? sel.filter((x) => x !== id) : []);

/** Where each of `cards` stands after a drag by `by`, from where it stood when the drag began. */
export const shifted = (cards: { id: string; start: Pos }[], by: Pos) =>
  Object.fromEntries(cards.map((c) => [c.id, { x: Math.round(c.start.x + by.x), y: Math.round(c.start.y + by.y) }]));

/** Set once the owner has marked cards: the hint on how, after moving a card alone, goes. */
export const MARK_KNOWN = 'obeya-mark-known';
/** Set once the owner has moved several marked cards together: the hint on how, beside the marked ones, goes. */
export const MOVE_MARKED_KNOWN = 'obeya-move-marked-known';
