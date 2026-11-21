/**
 * Reads a plan doc for which workstream builds on which: one session names, for each workstream
 * of the plan, the workstreams it builds on, so the board can arrange them left to right.
 */
import { z } from 'zod';
import { finished, type Item } from '../../../../core/types';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { readPlanDependenciesSystem } from '../../prompts/readPlanDependenciesSystem';
import { SeismicJob } from '../seismicJob';
import { CardTags } from './cardTags';

export interface ReadPlanDependenciesRun {
  runtime: AgentRuntime;
  /** Where the session reads: the plan's repository. */
  cwd: string;
  plan: Item;
  /** The plan's workstreams, in the plan's order. */
  kids: Item[];
  /** The keys the board calls the workstreams by, by card id (`Board.workstreamKeys`). */
  keys: Map<string, string>;
}

/** The workstreams' keys that each builds on, by key. */
type Dependencies = Record<string, string[]>;

/** Reads the plan doc for which workstream builds on which; keeps what it reports in `on`. */
class ReadPlanDependenciesJob extends SeismicJob<Dependencies> {
  override readonly role = 'koordinator' as const;
  readonly name = 'readPlanDependencies';
  readonly description = 'Reads which workstream of a plan builds on which.';
  private on: Dependencies | undefined;
  /** The tags the session calls the workstreams by. */
  private readonly tags: CardTags;

  constructor(private o: Omit<ReadPlanDependenciesRun, 'runtime' | 'cwd'>) {
    super();
    this.tags = new CardTags(o.kids);
  }

  protected answer() {
    return this.on ? { value: this.on } : undefined;
  }

  protected override missing() {
    return 'no dependencies';
  }

  getPrompt() {
    return readPlanDependenciesSystem;
  }

  async getBrief() {
    const { plan, kids } = this.o;
    return [
      `The plan: "${plan.title}"${plan.plan?.file ? `; plan doc ${plan.plan.file}` : ''}.`,
      plan.plan?.goal ? `Goal: ${plan.plan.goal}` : '',
      `Its workstreams, in the plan's order:\n${kids
        .map((k) => `- ${this.tags.tagOf(k.id)}${finished(k.state) ? ' (delivered)' : ''}: ${k.plan?.label ? `${k.plan.label} ` : ''}"${k.title}"${k.body ? ` — ${k.body.replace(/\s+/g, ' ').slice(0, 600)}` : ''}`)
        .join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  getJobTools(): AgentTool[] {
    const { kids, keys } = this.o;
    return [
      {
        name: 'dependencies',
        description: 'Report every workstream once: its tag and the tags of the workstreams it builds on (empty when it builds on none).',
        schema: { workstreams: z.array(z.object({ card: z.string(), builds_on: z.array(z.string()) })) },
        run: (a) => {
          if (this.on) return 'Already reported.';
          const found: Dependencies = {};
          for (const w of a.workstreams as { card: string; builds_on: string[] }[]) {
            const id = this.tags.idOf(w.card);
            if (!id) continue;
            found[keys.get(id)!] = w.builds_on.flatMap((t) => {
              const b = this.tags.idOf(t);
              return b && b !== id ? [keys.get(b)!] : [];
            });
          }
          const missing = kids.filter((k) => !finished(k.state) && !(keys.get(k.id)! in found));
          if (missing.length) return `Every open workstream at least, please: missing ${missing.map((k) => this.tags.tagOf(k.id)).join(', ')}. Call dependencies again with all of them.`;
          this.on = found;
          return this.finish('Recorded. End your turn now.');
        },
      },
    ];
  }
}

/** Reads which workstreams each workstream of a plan builds on, by key; throws with why the session gave none. */
export async function readPlanDependencies(o: ReadPlanDependenciesRun): Promise<Dependencies> {
  const { runtime, cwd, ...rest } = o;
  const result = await new ReadPlanDependenciesJob(rest).run(runtime, { cwd });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
