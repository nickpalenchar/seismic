/**
 * Schedules the cards of a batch together: the workstreams of a plan the owner started at once, or
 * cards whose waits ended at once. One read-only session reads them and what runs beside them, and
 * reports each card once, in the order they should go: likely files, what it waits for, duplicates.
 */
import { z } from 'zod';
import type { Item } from '../../../../core/types';
import type { Board } from '../../../board';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { scheduleCardBatchSystem } from '../../prompts/scheduleCardBatchSystem';
import { type JobRun, SeismicJob } from '../seismicJob';
import type { CardTags } from './cardTags';

/** A workstream as the Koordinator scheduled it, in its turn's order. */
export interface Planned {
  card: string;
  files: string[];
  duplicates: string[];
  waitsFor: string[];
  /** Those of `waitsFor` it builds on. */
  buildsOn: string[];
  reason: string;
}

export interface ScheduleCardBatchRun {
  runtime: AgentRuntime;
  board: Board;
  /** Where the session reads: the repository of the batch. */
  cwd: string;
  /** The plan whose workstreams are scheduled; none for cards freed at once. */
  planCard: Item | undefined;
  batch: Item[];
  /** Cards in progress and those queued ahead of the batch. */
  active: Item[];
  ahead: Item[];
  /** Unfinished cards to check for the same requested outcome; none with merge suggestions off. */
  candidates: Item[];
  /** The tags the session calls all of them by. */
  tags: CardTags;
  merges: boolean;
  folder: boolean;
  language: string;
  preferences?: string;
  /** What runs beside the batch, as lines of the brief; read when the job starts. */
  others: () => Promise<string[]>;
  onLimit: NonNullable<JobRun['onLimit']>;
}

/** Schedules the cards of a batch together; keeps the order it reports in `plan`. */
class ScheduleCardBatchJob extends SeismicJob<Planned[]> {
  override readonly role = 'koordinator' as const;
  readonly name = 'scheduleCardBatch';
  readonly description = 'Schedules the cards of a batch together.';
  private plan: Planned[] | undefined;

  constructor(private o: Omit<ScheduleCardBatchRun, 'runtime' | 'cwd' | 'onLimit'>) {
    super();
  }

  protected answer() {
    return this.plan ? { value: this.plan } : undefined;
  }

  protected override missing() {
    return 'no schedule';
  }

  getPrompt() {
    const { language, planCard, merges, folder, preferences } = this.o;
    const system = scheduleCardBatchSystem(language, !planCard, merges, folder);
    return preferences ? `${system}\n\n${preferences}` : system;
  }

  async getBrief() {
    const { planCard, batch, candidates, tags, merges } = this.o;
    return [
        ...(planCard
          ? [
              `The plan: "${planCard.title}"${planCard.plan?.file ? `; plan doc ${planCard.plan.file}` : ''}.`,
              planCard.plan?.goal ? `Goal: ${planCard.plan.goal}` : '',
              `Its workstreams to schedule, in the plan's order:\n${batch
                .map((w) => `- ${tags.tagOf(w.id)}: ${w.plan?.label ? `${w.plan.label} ` : ''}"${w.title}"${w.body ? ` — ${w.body.replace(/\s+/g, ' ').slice(0, 600)}` : ''}`)
                .join('\n')}`,
            ]
          : [
              `The cards to schedule, freed at once, in their order in the queue, which the owner may have set: keep it where neither a dependency nor a likely conflict asks for another:\n${batch
                .map((w) => {
                  const of = w.parent ? this.o.board.item(w.parent) : undefined;
                  const where = of?.plan?.file ? ` (workstream ${w.plan?.label ?? ''} of the plan "${of.title}", plan doc ${of.plan.file})` : '';
                  return `- ${tags.tagOf(w.id)}: ${w.kind} "${w.title}"${where}${w.body ? ` — ${w.body.replace(/\s+/g, ' ').slice(0, 1500)}` : ''}`;
                })
                .join('\n')}`,
            ]),
        ...(await this.o.others()),
        merges ? `Other unfinished tasks to check for the same requested outcome (planned, in progress or awaiting review):\n${candidates.map((a) => `- ${tags.tagOf(a.id)}: "${a.title}" (${a.state})${a.body ? ` — ${a.body.replace(/\s+/g, ' ').slice(0, 600)}` : ''}`).join('\n') || '(none)'}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  getJobTools(): AgentTool[] {
    const { planCard, batch, candidates, tags, merges, language } = this.o;
    const noun = planCard ? 'workstream' : 'card';
    return [
        {
          name: 'schedule',
          description: `Report every ${noun} once, in the order they should go: its tag, likely files, dependencies, conflicts,${merges ? ' possible duplicate cards (their tags),' : ''} and a one-sentence reason in ${language}.`,
          schema: {
            workstreams: z.array(
              z.object({
                card: z.string(),
                files: z.array(z.string()),
                builds_on: z.array(z.string()),
                conflicts_with: z.array(z.string()),
                ...(merges ? { duplicates: z.array(z.string()).optional() } : {}),
                reason: z.string(),
              }),
            ),
          },
          run: (a) => {
            if (this.plan) return 'Already reported.';
            const mine = new Set(batch.map((w) => w.id));
            const seen = new Set<string>();
            const order: Planned[] = [];
            for (const w of a.workstreams as { card: string; files: string[]; builds_on: string[]; conflicts_with: string[]; duplicates?: string[]; reason: string }[]) {
              const id = tags.idOf(w.card);
              if (!id || !mine.has(id) || seen.has(id)) continue;
              seen.add(id);
              const ids = (list: string[]) => list.map((t) => tags.idOf(t)).filter((x): x is string => !!x && x !== id);
              const buildsOn = ids(w.builds_on);
              order.push({
                card: id,
                files: w.files.slice(0, 200),
                duplicates: (w.duplicates ?? []).map((t) => tags.idOf(t)).filter((other): other is string => !!other && other !== id && candidates.some((c) => c.id === other)),
                waitsFor: [...new Set([...buildsOn, ...ids(w.conflicts_with)])],
                buildsOn,
                reason: String(w.reason).slice(0, 500),
              });
            }
            const missing = batch.filter((w) => !seen.has(w.id));
            if (missing.length) return `Every ${noun} once, please: missing ${missing.map((w) => tags.tagOf(w.id)).join(', ')}. Call schedule again with all of them.`;
            this.plan = order;
            return this.finish('Recorded. End your turn now.');
          },
        },
    ];
  }
}

/** Schedules the cards of a batch in the order they should go; throws with why the session gave none. */
export async function scheduleCardBatch(o: ScheduleCardBatchRun): Promise<Planned[]> {
  const { runtime, cwd, onLimit, ...rest } = o;
  const result = await new ScheduleCardBatchJob(rest).run(runtime, { cwd, onLimit });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
