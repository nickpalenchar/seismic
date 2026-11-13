// Read-only comparison of two cards, reviewed by the owner before anything dissolves.
import { z } from 'zod';
import { ownersLanguage } from '../core/locale';
import { messageOf } from '../core/text';
import { mergeRank, type Item, type Merge } from '../core/types';
import type { Board } from './board';
import { readSession } from './koordinator';
import type { AgentRuntime } from './runtime';
import { proposalTask } from './workers';

export interface MergeOptions {
  board: Board;
  runtime: AgentRuntime;
  pathFor: (card: Item) => string;
  preferences?: () => string;
  imageFiles?: (ids: string[]) => string[];
  /** How long after a change to a merging card the watcher looks, so a burst of edits makes one comparison. */
  settleMs?: number;
}
type Result = Omit<Merge, 'with' | 'failed'> & { title: string; task: string };

const combined = z.object({ title: z.string().trim().min(1).max(200), task: z.string().trim().min(1).max(20000) });
const comparison = z.object({
  outcome: z.enum(['covered', 'followUp']),
  titleCovered: z.boolean(),
  parts: z.array(z.object({ text: z.string(), covered: z.boolean() })),
  followUp: z.object({
    title: z.string().trim().min(1).max(200),
    task: z.string().trim().min(1).max(20000),
    images: z.array(z.string()),
    questions: z.array(z.number().int().nonnegative()),
  }).optional(),
});

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

  private soon() {
    const { board } = this.o;
    board.separateDeletedMerges();
    const live = new Set<string>();
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
  }

  /**
   * A comparison whose cards changed since it read them is made again; a pair that can no longer
   * become one is separated, whether its comparison runs, is in or failed. A failed comparison of
   * unchanged cards waits for the owner's "Try again".
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
        // a comparison that is in (a result or a failure) is checked against what it read, one running against what it is reading
        const read = merge.task !== undefined || merge.failed !== undefined ? merge.compared : this.reading.get(i.id);
        // one that has not read the cards yet reads them as they are now; a failure from before the reads were kept waits for
        // "Try again", while a result from then is made again, as nothing tells what it read
        if (!read && merge.task === undefined) continue;
        const changed = board.mergeChanges(i, other, read);
        if (!changed.length) continue;
        board.mergeAgain(i.id, changed);
        this.run(i.id);
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

  private async ask(card: Item, other: Item): Promise<Result> {
    let merged: Result | undefined;
    const preserve = mergeRank(other) > 1;
    const compared = this.o.board.mergeReads(card, other);
    const summary = compared.summary;
    const error = await readSession(this.o.runtime, {
      cwd: this.o.pathFor(other),
      role: 'koordinator',
      images: this.o.imageFiles?.(card.images ?? []),
      at: { card: card.id },
      onLimit: (until, retry) => this.o.board.waitsForLimit({ card: card.id }, until, retry),
      system: [SYSTEM, this.o.preferences?.() ?? ''].filter(Boolean).join('\n\n'),
      tools: (finish) => [{
        name: 'merge_cards',
        description: [
          ownersLanguage(this.o.board.conversation()),
          preserve
            ? 'Preserve the right card. Give outcome covered or followUp, titleCovered for the left title, and parts that reproduce the entire left task exactly, in order, each marked covered true or false. For followUp provide only uncovered work, image IDs and zero-based question indexes relevant to that work. For covered every part is covered and followUp is omitted.'
            : `Write title and task combining both unworked cards. ${proposalTask('either card nor this conversation')}`,
        ].join(' '),
        schema: preserve ? comparison.shape : combined.shape,
        run: (r) => {
          if (merged) return 'Only the first one counts.';
          if (preserve) {
            const parsed = comparison.safeParse(r);
            if (!parsed.success) return 'Not recorded: give outcome, exact task parts, and a complete followUp for uncovered work.';
            const v = parsed.data;
            if (v.parts.map((p) => p.text).join('') !== card.body) return 'Not recorded: parts must reproduce the entire left task exactly, including whitespace.';
            if (v.outcome === 'covered' ? !v.titleCovered || v.parts.some((p) => !p.covered) || !!v.followUp : !v.followUp || (v.titleCovered && !v.parts.some((p) => !p.covered))) return 'Not recorded: covered requires every part covered; followUp requires uncovered parts and a follow-up.';
            if (v.followUp?.images.some((id) => !card.images?.includes(id)) || v.followUp?.questions.some((n) => !card.idea?.proposal?.questions[n])) return 'Not recorded: use only image IDs and question indexes from the left card.';
            merged = { ...v, title: other.title, task: other.body, compared };
          } else {
            const parsed = combined.safeParse(r);
            if (!parsed.success) return 'Not recorded: provide a non-empty title (up to 200 characters) and task (up to 20000).';
            merged = { ...parsed.data, compared };
          }
          return finish('Recorded. End your turn now.');
        },
      }],
      brief: this.message(card, other, preserve, summary),
    });
    if (merged) return merged;
    if (error !== undefined) throw new Error(error);
    throw new Error('the agent gave no merged text');
  }

  private message(card: Item, other: Item, preserve: boolean, summary: string): string {
    const describe = (i: Item, what: string, proposal = i.idea?.proposal) => [
      `${what} (${i.archivedAt ? 'archived' : i.state}):\n\n<title>${i.title}</title>\n\n<task>\n${i.body}\n</task>`,
      proposal?.reason ? `Why it was proposed (for the owner only): ${proposal.reason}` : '',
      proposal?.questions.length ? `Questions to the owner (keep separate from the task):\n${proposal.questions.map((q, n) => `${n}: ${q.text}`).join('\n')}` : '',
      i.images?.length ? `Screenshot IDs: ${i.images.join(', ')}` : '',
    ].filter(Boolean).join('\n\n');
    return [
      preserve ? 'The right card has progressed and stays untouched. Compare the left task against the right task plus handover summary. Return covered or followUp.' : 'Both cards are unworked. Combine their requirements into one title and task.',
      describe(card, 'Left card, which dissolves'), describe(other, 'Right card, which survives'),
      preserve && summary ? `<handover-summary>\n${summary}\n</handover-summary>` : '',
    ].filter(Boolean).join('\n\n---\n\n');
  }
}

const SYSTEM = `You compare two cards on Seismic, a project on which the owner directs coding agents. Compare only the supplied card texts and handover summary, without reading repository files or branch diffs. Use their text and the survivor's handover summary as evidence.
When both are unworked, write the one card both become: include everything either asks for once, preserving their words where they agree. Questions stay questions.
When the right card has progressed, it stays exactly as it is. Mark whether the left title and each exact part of its task are covered, including a request expressed only in the title. If all work is covered, return covered. Otherwise return followUp with a standalone task containing only the extra work, and the left card's screenshots and questions relevant to that extra work. Only mark work covered when the supplied text or summary supports that judgement. The owner checks your comparison before approving.
Then call merge_cards once and end your turn.`;
