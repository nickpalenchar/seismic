/**
 * Estimates the scope of a card about to start: a short read-only session reads the card and what
 * runs or waits beside it, and reports its likely files, the cards its changes would conflict with, the
 * workstreams it builds on and the unfinished cards that ask for the same outcome.
 */
import { z } from 'zod';
import type { Item } from '../../../../core/types';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { estimateCardScopeSystem } from '../../prompts/estimateCardScopeSystem';
import { type JobRun, SeismicJob } from '../seismicJob';
import type { CardTags } from './cardTags';

export interface Scope {
  files: string[];
  /** Unfinished cards that appear to ask for the same outcome. */
  duplicates: string[];
  /** Cards in progress or queued ahead whose changes the Koordinator expects to conflict with this card's on merge. */
  conflictsWith: string[];
  /** Workstreams of its plan it builds on: they hold it until they have landed, also while not started. */
  buildsOn: string[];
  reason: string;
}

export interface EstimateCardScopeRun {
  runtime: AgentRuntime;
  /** Where the session reads: the card's repository. */
  cwd: string;
  card: Item;
  /** Cards in progress, queued ahead of this one, and the plan's other workstreams that have not landed. */
  active: Item[];
  ahead: Item[];
  pending: Item[];
  /** Unfinished cards to check for the same requested outcome; none with merge suggestions off. */
  candidates: Item[];
  /** The tags the session calls them all by, this card's neighbours and candidates. */
  tags: CardTags;
  /** Whether merge suggestions are on: the session is told of duplicates only then. */
  merges: boolean;
  /** A folder without git: its cards work in the folder itself. */
  folder: boolean;
  /** The language of the reason, with the clause that standing preferences may name another. */
  language: string;
  /** The owner's standing preferences, added to the instructions. */
  preferences?: string;
  /** What the card and what runs beside it are, as the session reads it; read when the job starts. */
  brief: () => Promise<string>;
  onLimit: NonNullable<JobRun['onLimit']>;
}

/** Estimates the files, conflicts, dependencies and duplicates of a card about to start; keeps its report in `scope`. */
class EstimateCardScopeJob extends SeismicJob<Scope> {
  override readonly role = 'koordinator' as const;
  readonly name = 'estimateCardScope';
  readonly description = "Estimates the files, conflicts and dependencies of a card about to start.";
  private scope: Scope | undefined;

  constructor(private o: Omit<EstimateCardScopeRun, 'runtime' | 'cwd' | 'onLimit'>) {
    super();
  }

  protected answer() {
    return this.scope ? { value: this.scope } : undefined;
  }

  protected override missing() {
    return 'no estimate';
  }

  getPrompt() {
    const { language, merges, folder, preferences } = this.o;
    const system = estimateCardScopeSystem(language, merges, folder);
    return preferences ? `${system}\n\n${preferences}` : system;
  }

  async getBrief() {
    const { merges, candidates, tags } = this.o;
    const brief = await this.o.brief();
    return merges
      ? `${brief}\n\nOther unfinished tasks to check for the same requested outcome (planned, in progress or awaiting review):\n${candidates.map((a) => `- ${tags.tagOf(a.id)}: "${a.title}" (${a.state})${a.body ? ` — ${a.body.replace(/\s+/g, ' ').slice(0, 600)}` : ''}`).join('\n') || '(none)'}`
      : brief;
  }

  getJobTools(): AgentTool[] {
    const { card, active, ahead, pending, candidates, tags, merges, language } = this.o;
    // a conflict only with what runs or goes first; building on only a workstream of its plan
    const running = new Set([...active, ...ahead].map((a) => a.id));
    const siblings = new Set([...active, ...ahead, ...pending].filter((a) => card.parent && a.parent === card.parent).map((a) => a.id));
    const possible = new Set(candidates.map((a) => a.id));
    const ids = (list: unknown, among: Set<string>) =>
      (Array.isArray(list) ? list : []).map((t) => tags.idOf(String(t))).filter((x): x is string => !!x && among.has(x));
    return [
        {
          name: 'scope',
          description: `Report likely files, merge conflicts, dependencies,${merges ? ' possible duplicate cards (their tags),' : ''} and a one-sentence reason in ${language}.`,
          schema: {
            files: z.array(z.string()),
            conflicts_with: z.array(z.string()),
            builds_on: z.array(z.string()).optional(),
            ...(merges ? { duplicates: z.array(z.string()).optional() } : {}),
            reason: z.string(),
          },
          run: (a) => {
            if (this.scope) return 'Already reported.';
            this.scope = {
              files: (a.files as string[]).slice(0, 200),
              duplicates: ids(a.duplicates, possible),
              conflictsWith: ids(a.conflicts_with, running),
              buildsOn: ids(a.builds_on, siblings),
              reason: String(a.reason).slice(0, 500),
            };
            return this.finish('Recorded. End your turn now.');
          },
        },
    ];
  }
}

/** Estimates a card's scope; throws with why the session gave none. */
export async function estimateCardScope(o: EstimateCardScopeRun): Promise<Scope> {
  const { runtime, cwd, onLimit, ...rest } = o;
  const result = await new EstimateCardScopeJob(rest).run(runtime, { cwd, onLimit });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
