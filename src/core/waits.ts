

import type { Messages } from './messages';
import { type Item, merging, needsYou, snoozeOf } from './types';


export type PushKind = Exclude<keyof Messages['push'], 'several'>;






export type NeedsYouKind = PushKind | 'rule' | 'setting' | 'answer';





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

/** What a card that needs the owner waits for; `before`: the card as it was before it did (a failed landing was landing, or its approval could not land for the checkout's changes). */
export function kindOf(i: Item, before?: Item): PushKind {
  if (before?.review?.landing || i.review?.blocked) return 'landing';
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

