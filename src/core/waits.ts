// What a card waits for the owner for, and which cards started to: shared by the server's pushes to
// the phone and the desktop notifications of the project page.
import type { Messages } from './messages';
import { type Item, merging, needsYou, snoozeOf } from './types';

/** What a card waits for, as a push says it. */
export type PushKind = Exclude<keyof Messages['push'], 'several'>;

/**
 * What waits for the owner in "Needs you" (a row of the server's `needs_you` table): a card, by what
 * it waits for (`PushKind`), or a proposed rule, a setting proposal, or the Koordinator's latest
 * unread answer on a project.
 */
export type NeedsYouKind = PushKind | 'rule' | 'setting' | 'answer';

/**
 * One open wait for the owner, as the snapshot sends it: what waits (exactly one of `card`,
 * `preference`, `setting`, `talk`), since when (ms) and when what it waits on last changed (ms).
 */
export interface NeedsYou {
  id: number;
  kind: NeedsYouKind;
  card?: string;
  preference?: number;
  setting?: number;
  talk?: number;
  createdAt: number;
  lastUpdated: number;
}

/** What a card that needs the owner waits for; `before`: the card as it was before it did (a failed landing was landing). */
export function kindOf(i: Item, before?: Item): PushKind {
  if (before?.review?.landing) return 'landing';
  if (i.idea?.proposal?.merge && !merging(i)) return 'merge';
  if (i.state === 'proposal') return 'proposal';
  if (i.idea?.superseded) return 'superseded';
  if (i.state === 'inPr') return 'pr';
  if (i.idea?.discussion) return 'idea';
  if (i.need === 'question') return i.question?.stuck ? 'stuck' : 'question';
  if (i.review?.answered) return 'answered';
  return i.need === 'demo' ? 'demo' : 'review';
}

/**
 * The cards of `after` that need the owner and did not in `before` (the items by id), with what they
 * wait for; a card its agent withdrew or replaced just now, also when it waited for them already.
 */
export function startedWaiting(before: ReadonlyMap<string, Item>, after: readonly Item[]): { item: Item; kind: PushKind }[] {
  return after.flatMap((i) => {
    const was = before.get(i.id);
    if (i.idea?.superseded && was && !was.idea?.superseded && !snoozeOf(i)) return [{ item: i, kind: 'superseded' as const }];
    return needsYou(i) && !(was && needsYou(was)) ? [{ item: i, kind: kindOf(i, was) }] : [];
  });
}

/** A title as plain text: a notification shows no markdown. */
export const plainTitle = (md: string) =>
  md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .trim();

