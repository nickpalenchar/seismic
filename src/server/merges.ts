// Read-only comparison of two cards, reviewed by the owner before anything dissolves.
import { messageOf } from '../core/text';
import type { Item, Merge } from '../core/types';
import type { Board } from './board';
import { compareCards, type MergeResult as Result } from './llms/agents/agentJobs/cardMerge';
import type { AgentRuntime } from './runtime';

export interface MergeOptions {
  board: Board;
  runtime: AgentRuntime;
  pathFor: (card: Item) => string;
  preferences?: () => string;
  imageFiles?: (ids: string[]) => string[];
  /** How long after a change to a merging card the watcher looks, so a burst of edits makes one comparison. */
  settleMs?: number;
}

export class Merges {
  private busy = new Map<string, string | undefined>();
  /** What the comparison running for a card read of the pair, by card. */
  private reading = new Map<string, NonNullable<Merge['compared']>>();
  private watched = new Map<string, { fingerprint: string; timer?: ReturnType<typeof setTimeout> }>();
  private unwatch: () => void;
  constructor(private o: MergeOptions) {
    this.unwatch = o.board.onChange(() => this.soon());
  }

  merge(cardId: string, withId: string) {
    this.run(this.o.board.mergeStart(cardId, withId));
  }

  resume() {
    // what changed while Seismic was not running: a pair that can no longer merge separates before anything runs
    this.check();
    for (const i of this.o.board.items()) {
      const merge = i.idea?.proposal?.merge;
      if (merge && merge.task === undefined && merge.failed === undefined) this.run(i.id);
    }
  }

  /** The card merging card `id` is merged with, wherever it is; none once it is deleted. */
  private partner(merge: Merge): Item | undefined {
    try { return this.o.board.card(merge.with); } catch { return undefined; }
  }

  shutdown() {
    this.unwatch();
    for (const pair of this.watched.values()) clearTimeout(pair.timer);
    this.watched.clear();
  }

  /**
   * A change to a merging pair makes its comparison out of date at once, so the result before shows as
   * updating and cannot be approved; only the agent's new comparison waits for the edits to settle.
   */
  private soon() {
    const { board } = this.o;
    board.separateDeletedMerges();
    const live = new Set<string>();
    const outdated: [string, string[]][] = [];
    for (const card of board.items()) {
      const merge = card.idea?.proposal?.merge;
      if (!merge) continue;
      live.add(card.id);
      const other = this.partner(merge);
      // Only inputs to this comparison (or its eligibility/attempt) extend its deadline.
      // Results, status messages, and edits to other pairs must not postpone it.
      const fingerprint = JSON.stringify([merge.with, merge.attempt, other && board.mergeReads(card, other), !!other && board.stillMergeable(card, other)]);
      const was = this.watched.get(card.id);
      if (was?.fingerprint === fingerprint) continue;
      const changed = other && board.stillMergeable(card, other) ? this.changes(card, other, merge) : [];
      if (changed.length) outdated.push([card.id, changed]);
      clearTimeout(was?.timer);
      const pair: { fingerprint: string; timer?: ReturnType<typeof setTimeout> } = { fingerprint };
      pair.timer = setTimeout(() => {
        pair.timer = undefined;
        this.check(card.id);
      }, this.o.settleMs ?? 3000);
      pair.timer.unref?.();
      this.watched.set(card.id, pair);
    }
    for (const [id, pair] of this.watched) {
      if (live.has(id)) continue;
      clearTimeout(pair.timer);
      this.watched.delete(id);
    }
    for (const [id, changed] of outdated) {
      try { board.mergeAgain(id, changed); } catch (e) { console.error('merge:', e); }
    }
  }

  /** The cards of merging card `card` that changed since its comparison read them; none for one that has yet to read them. */
  private changes(card: Item, other: Item, merge: Merge): string[] {
    // a comparison that is in (a result or a failure) is checked against what it read, one running against what it is reading
    const running = this.busy.has(card.id) && this.busy.get(card.id) === merge.attempt;
    const read = merge.task !== undefined || merge.failed !== undefined ? merge.compared : running ? this.reading.get(card.id) : undefined;
    // one that has not read the cards yet reads them as they are now; a failure from before the reads were kept waits for
    // "Try again", while a result from then is made again, as nothing tells what it read
    if (!read && merge.task === undefined) return [];
    return this.o.board.mergeChanges(card, other, read);
  }

  /**
   * A comparison whose cards changed since it read them is made again, and one marked out of date
   * when the change came in runs now; a pair that can no longer become one is separated, whether its
   * comparison runs, is in or failed. A failed comparison of unchanged cards waits for the owner's "Try again".
   */
  private check(only?: string) {
    const { board } = this.o;
    board.separateDeletedMerges();
    for (const i of board.items()) {
      if (only !== undefined && i.id !== only) continue;
      const merge = i.idea?.proposal?.merge;
      if (!merge) continue;
      try {
        const other = this.partner(merge);
        if (!other || !board.stillMergeable(i, other)) {
          board.separate(i.id, other ? 'unmergeable' : 'gone');
          continue;
        }
        const changed = this.changes(i, other, merge);
        if (changed.length) board.mergeAgain(i.id, changed);
        const now = board.item(i.id)?.idea?.proposal?.merge;
        // run does nothing for an attempt that runs already
        if (now && now.task === undefined && now.failed === undefined) this.run(i.id);
      } catch (e) {
        console.error('merge:', e);
      }
    }
  }

  private run(cardId: string) {
    const card = this.o.board.item(cardId);
    const merge = card?.idea?.proposal?.merge;
    const other = merge && this.partner(merge);
    if (!card || !other) return;
    const attempt = card.idea?.proposal?.merge?.attempt;
    if (this.busy.has(cardId) && this.busy.get(cardId) === attempt) return;
    this.busy.set(cardId, attempt);
    this.reading.set(cardId, this.o.board.mergeReads(card, other));
    this.ask(card, other)
      .then(
        (r) => void this.o.board.merged(cardId, r, attempt),
        // what the failed attempt read: a change since then makes it again, as for a result
        (e) => void this.o.board.merged(cardId, { failed: messageOf(e), compared: this.reading.get(cardId) }, attempt),
      )
      .catch((e) => console.error('merge:', e))
      .finally(() => { if (this.busy.get(cardId) === attempt) { this.busy.delete(cardId); this.reading.delete(cardId); } });
  }

  private ask(card: Item, other: Item): Promise<Result> {
    const compared = this.o.board.mergeReads(card, other);
    return compareCards({
      runtime: this.o.runtime,
      board: this.o.board,
      cwd: this.o.pathFor(other),
      card,
      other,
      compared,
      preferences: this.o.preferences?.() ?? '',
      images: this.o.imageFiles?.(card.images ?? []),
      onLimit: (until, retry) => this.o.board.waitsForLimit({ card: card.id }, until, retry),
    });
  }
}

