/**
 * Reads a plan doc for which workstream builds on which: one session names, for each workstream
 * of the plan, the workstreams it builds on, so the board can arrange them left to right.
 */
import { z } from 'zod';
import { finished, type Item } from '../../../../core/types';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { depsSystem } from '../../prompts/depsSystem';
import { SeismicJob } from '../seismicJob';

export interface DependenciesRun {
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

/** The session that reads the plan doc; what it reports is kept in `on`. */
class PlanDependenciesJob extends SeismicJob<Dependencies> {
  override readonly role = 'koordinator' as const;
  readonly name = 'planDependencies';
  readonly description = 'Reads which workstream of a plan builds on which.';
  private on: Dependencies | undefined;
  /** The tags the session calls the workstreams by (`K1`…), to the cards' ids. */
  private readonly tags: Map<string, string>;

  constructor(private o: Omit<DependenciesRun, 'runtime' | 'cwd'>) {
    super();
    this.tags = new Map(o.kids.map((k, n) => [`K${n + 1}`, k.id]));
  }

  protected answer() {
    return this.on ? { value: this.on } : undefined;
  }

  protected override missing() {
    return 'no dependencies';
  }

  private tagOf(id: string): string {
    return [...this.tags].find(([, x]) => x === id)![0];
  }

  getPrompt() {
    return depsSystem;
  }

  async getBrief() {
    const { plan, kids } = this.o;
    return [
      `The plan: "${plan.title}"${plan.plan?.file ? `; plan doc ${plan.plan.file}` : ''}.`,
      plan.plan?.goal ? `Goal: ${plan.plan.goal}` : '',
      `Its workstreams, in the plan's order:\n${kids
        .map((k) => `- ${this.tagOf(k.id)}${finished(k.state) ? ' (delivered)' : ''}: ${k.plan?.label ? `${k.plan.label} ` : ''}"${k.title}"${k.body ? ` — ${k.body.replace(/\s+/g, ' ').slice(0, 600)}` : ''}`)
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
            const id = this.tags.get(w.card);
            if (!id) continue;
            found[keys.get(id)!] = w.builds_on.flatMap((t) => {
              const b = this.tags.get(t);
              return b && b !== id ? [keys.get(b)!] : [];
            });
          }
          const missing = kids.filter((k) => !finished(k.state) && !(keys.get(k.id)! in found));
          if (missing.length) return `Every open workstream at least, please: missing ${missing.map((k) => this.tagOf(k.id)).join(', ')}. Call dependencies again with all of them.`;
          this.on = found;
          return this.finish('Recorded. End your turn now.');
        },
      },
    ];
  }
}

/** The keys each workstream builds on, by key; throws with why the session gave none. */
export async function readDependencies(o: DependenciesRun): Promise<Dependencies> {
  const { runtime, cwd, ...rest } = o;
  const result = await new PlanDependenciesJob(rest).run(runtime, { cwd });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
