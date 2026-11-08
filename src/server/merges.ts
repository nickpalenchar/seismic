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
  constructor(private o: MergeOptions) {}

  merge(cardId: string, withId: string) {
    this.run(this.o.board.mergeStart(cardId, withId));
  }

  resume() {
    for (const i of this.o.board.items()) if (i.proposal?.merge && i.proposal.merge.task === undefined && i.proposal.merge.failed === undefined) this.run(i.id);
  }

  private run(cardId: string) {
    const card = this.o.board.item(cardId);
    const other = card?.proposal?.merge && this.o.board.card(card.proposal.merge.with);
    if (!card || !other) return;
    const attempt = card.proposal?.merge?.attempt;
    if (this.busy.has(cardId) && this.busy.get(cardId) === attempt) return;
    this.busy.set(cardId, attempt);
    this.ask(card, other)
      .then(
        (r) => void this.o.board.merged(cardId, r, attempt),
        (e) => void this.o.board.merged(cardId, { failed: messageOf(e) }, attempt),
      )
      .catch((e) => console.error('merge:', e))
      .finally(() => { if (this.busy.get(cardId) === attempt) this.busy.delete(cardId); });
  }

  private async ask(card: Item, other: Item): Promise<Result> {
    let merged: Result | undefined;
    const preserve = mergeRank(other) > 1;
    const summary = this.o.board.summary(other.id) ?? '';
    const compared = { left: JSON.stringify([card.title, card.body, card.images, card.proposal?.questions ?? []]), right: JSON.stringify([other.title, other.body]), summary };
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
            if (v.followUp?.images.some((id) => !card.images?.includes(id)) || v.followUp?.questions.some((n) => !card.proposal?.questions[n])) return 'Not recorded: use only image IDs and question indexes from the left card.';
            merged = { ...v, title: other.title, task: other.body, compared };
          } else {
            const parsed = combined.safeParse(r);
            if (!parsed.success) return 'Not recorded: provide a non-empty title (up to 200 characters) and task (up to 20000).';
            merged = parsed.data;
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
    const describe = (i: Item, what: string) => [
      `${what} (${i.archivedAt ? 'archived' : i.state}):\n\n<title>${i.title}</title>\n\n<task>\n${i.body}\n</task>`,
      i.proposal?.reason ? `Why it was proposed (for the owner only): ${i.proposal.reason}` : '',
      i.proposal?.questions.length ? `Questions to the owner (keep separate from the task):\n${i.proposal.questions.map((q, n) => `${n}: ${q.text}`).join('\n')}` : '',
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
