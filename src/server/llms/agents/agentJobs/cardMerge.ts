/**
 * Compares two cards the owner is merging, read-only: where both are unworked, one session writes the
 * card they become; where the right card has progressed, it marks what of the left card that one covers
 * and what is left for a follow-up. The owner reviews the result before anything dissolves.
 */
import { z } from 'zod';
import { ownersLanguage } from '../../../../core/locale';
import { mergeRank, type Item, type Merge } from '../../../../core/types';
import type { Board } from '../../../board';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { workerConfig } from '../../../worker-config';
import { cardMergeSystem } from '../../prompts/cardMergeSystem';
import { type JobRun, SeismicJob } from '../seismicJob';

/** What the comparison gives: the merged text, or what of the left card the right one covers. */
export type MergeResult = Omit<Merge, 'with' | 'failed'> & { title: string; task: string };

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

export interface MergeRun {
  runtime: AgentRuntime;
  board: Board;
  /** Where the session reads: the right card's checkout. */
  cwd: string;
  /** The left card, which dissolves, and the right one, which survives. */
  card: Item;
  other: Item;
  /** What the pair read, as the result records it. */
  compared: NonNullable<Merge['compared']>;
  /** The owner's standing preferences, added to the instructions. */
  preferences?: string;
  /** The files of the left card's screenshots. */
  images?: string[];
  onLimit?: JobRun['onLimit'];
}

/** The comparison session; what it gives is kept in `merged`. */
class CardMergeJob extends SeismicJob<MergeResult> {
  override readonly role = 'koordinator' as const;
  readonly name = 'cardMerge';
  readonly description = 'Compares two cards the owner is merging.';
  private merged: MergeResult | undefined;
  /** Whether the right card has progressed: the left one is then compared against it, not combined. */
  private readonly preserve: boolean;

  constructor(private o: Pick<MergeRun, 'board' | 'card' | 'other' | 'compared' | 'preferences'>) {
    super();
    this.preserve = mergeRank(o.other) > 1;
  }

  protected answer() {
    return this.merged ? { value: this.merged } : undefined;
  }

  protected override missing() {
    return 'the agent gave no merged text';
  }

  getPrompt() {
    return [cardMergeSystem, this.o.preferences ?? ''].filter(Boolean).join('\n\n');
  }

  getBrief() {
    const { card, other, compared } = this.o;
    const { preserve } = this;
    const summary = compared.summary;
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

  getJobTools(): AgentTool[] {
    const { card, other, compared } = this.o;
    const preserve = this.preserve;
    return [{
      name: 'merge_cards',
      description: [
        ownersLanguage(this.o.board.conversation()),
        preserve
          ? 'Preserve the right card. Give outcome covered or followUp, titleCovered for the left title, and parts that reproduce the entire left task exactly, in order, each marked covered true or false. For followUp provide only uncovered work, image IDs and zero-based question indexes relevant to that work. For covered every part is covered and followUp is omitted.'
          : `Write title and task combining both unworked cards. ${workerConfig.proposalTask('either card nor this conversation')}`,
      ].join(' '),
      schema: preserve ? comparison.shape : combined.shape,
      run: (r) => {
        if (this.merged) return 'Only the first one counts.';
        if (preserve) {
          const parsed = comparison.safeParse(r);
          if (!parsed.success) return 'Not recorded: give outcome, exact task parts, and a complete followUp for uncovered work.';
          const v = parsed.data;
          if (v.parts.map((p) => p.text).join('') !== card.body) return 'Not recorded: parts must reproduce the entire left task exactly, including whitespace.';
          if (v.outcome === 'covered' ? !v.titleCovered || v.parts.some((p) => !p.covered) || !!v.followUp : !v.followUp || (v.titleCovered && !v.parts.some((p) => !p.covered))) return 'Not recorded: covered requires every part covered; followUp requires uncovered parts and a follow-up.';
          if (v.followUp?.images.some((id) => !card.images?.includes(id)) || v.followUp?.questions.some((n) => !card.idea?.proposal?.questions[n])) return 'Not recorded: use only image IDs and question indexes from the left card.';
          this.merged = { ...v, title: other.title, task: other.body, compared };
        } else {
          const parsed = combined.safeParse(r);
          if (!parsed.success) return 'Not recorded: provide a non-empty title (up to 200 characters) and task (up to 20000).';
          this.merged = { ...parsed.data, compared };
        }
        return this.finish('Recorded. End your turn now.');
      },
    }];
  }
}

/** The comparison of two cards; throws with why the session gave none. */
export async function compareCards(o: MergeRun): Promise<MergeResult> {
  const { runtime, cwd, images, onLimit, ...rest } = o;
  const result = await new CardMergeJob(rest).run(runtime, { cwd, at: { card: o.card.id }, ...(images ? { images } : {}), ...(onLimit ? { onLimit } : {}) });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
