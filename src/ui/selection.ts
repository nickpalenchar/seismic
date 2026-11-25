



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


export const MARK_KNOWN = 'seismic-mark-known';

export const MOVE_MARKED_KNOWN = 'seismic-move-marked-known';
