// What a card waits for the owner for, and which cards started to: shared by the server's pushes to
// the phone and the desktop notifications of the project page.
import type { Messages } from './messages';
import { type Item, needsYou } from './types';

/** What a card waits for, as a push says it. */
export type PushKind = Exclude<keyof Messages['push'], 'several'>;

/** What a card that needs the owner waits for; `before`: the card as it was before it did (a failed landing was landing). */
export function kindOf(i: Item, before?: Item): PushKind {
  if (before?.landing) return 'landing';
  if (i.state === 'proposal') return 'proposal';
  if (i.superseded) return 'superseded';
  if (i.state === 'inPr') return 'pr';
  if (i.idea) return 'idea';
  if (i.need === 'question') return i.question?.stuck ? 'stuck' : 'question';
  if (i.answered) return 'answered';
  return i.need === 'demo' ? 'demo' : 'review';
}

/**
 * The cards of `after` that need the owner and did not in `before` (the items by id), with what they
 * wait for; a card its agent withdrew or replaced just now, also when it waited for them already.
 */
export function startedWaiting(before: ReadonlyMap<string, Item>, after: readonly Item[]): { item: Item; kind: PushKind }[] {
  return after.flatMap((i) => {
    const was = before.get(i.id);
    if (i.superseded && was && !was.superseded && !i.snoozed) return [{ item: i, kind: 'superseded' as const }];
    return needsYou(i) && !(was && needsYou(was)) ? [{ item: i, kind: kindOf(i, was) }] : [];
  });
}

/** A title as plain text: a notification shows no markdown. */
export const plainTitle = (md: string) =>
  md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .trim();

