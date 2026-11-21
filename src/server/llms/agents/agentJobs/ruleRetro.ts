/**
 * The retrospective on the owner's inputs: one session reads what happened on the project since the
 * last one and proposes rules for patterns that show across several cards.
 */
import { z } from 'zod';
import type { Board } from '../../../board';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { ruleRetroSystem } from '../../prompts/ruleRetroSystem';
import { reposParam } from '../../prompts/whereRulesGo';
import { type JobRun, SeismicJob } from '../seismicJob';
import { ownerFacing, proposalTargets, ruleLines } from './ruleProposals';

/** At most how many rules one retrospective proposes. */
export const RULE_RETRO_PROPOSALS = 3;

export interface RuleRetroRun {
  runtime: AgentRuntime;
  board: Board;
  /** Where the session reads: the project's home repository. */
  cwd: string;
  /** The language the proposals are written in, with the clause that standing preferences may name another. */
  language: string;
  /** What happened since the last retrospective, oldest first. */
  history: string[];
  onLimit?: JobRun['onLimit'];
}

/** The retrospective session; its proposals go to the board as the owner's to decide. */
class RuleRetroJob extends SeismicJob {
  override readonly role = 'koordinator' as const;
  readonly name = 'ruleRetro';
  readonly description = "Proposes rules for the patterns in what the owner did since the last retrospective.";
  private proposed = 0;
  /** The recorded rules as the session numbered them. */
  private readonly rules;

  constructor(private o: Omit<RuleRetroRun, 'runtime' | 'cwd' | 'onLimit'>) {
    super();
    this.rules = o.board.preferences('active');
  }

  protected answer() {
    return { value: undefined };
  }

  getPrompt() {
    return ownerFacing(this.o.board, ruleRetroSystem(this.o.language, RULE_RETRO_PROPOSALS));
  }

  async getBrief() {
    return [`What happened on the project since the last retrospective, oldest first:\n${this.o.history.join('\n')}`, ...ruleLines(this.o.board, null)].filter(Boolean).join('\n\n');
  }

  getJobTools(): AgentTool[] {
    const { board, language } = this.o;
    return [
      {
        name: 'propose',
        description: `Propose a rule to the owner: one short rule in ${language}, and why (one short sentence in ${language}, under 150 characters, naming what in the history it rests on). Pass replaces with the number of a recorded rule it refines or contradicts. ${reposParam}`,
        schema: { rule: z.string(), why: z.string(), replaces: z.number().int().optional(), repos: z.array(z.string()).optional() },
        run: ({ rule, why, replaces, repos }) => {
          const r = String(rule).trim().slice(0, 500);
          if (!r) return 'Empty rule ignored.';
          if (this.proposed >= RULE_RETRO_PROPOSALS) return this.finish(`At most ${RULE_RETRO_PROPOSALS} proposals. End your turn now.`);
          const targets = proposalTargets(board, repos);
          if (typeof targets === 'string') return targets;
          const fresh = targets.filter((t) => !board.preferences('proposed').some((p) => p.text === r && p.target === t));
          if (!fresh.length) return 'Already proposed.';
          const old = typeof replaces === 'number' ? this.rules[replaces - 1] : undefined;
          for (const t of fresh) board.proposePreference(r, { review: true, quote: String(why ?? '') }, old?.id, t);
          this.proposed++;
          return this.proposed < RULE_RETRO_PROPOSALS ? 'Proposed.' : this.finish('Proposed. That was the last one; end your turn now.');
        },
      },
      { name: 'done', description: 'Nothing (more) to propose.', schema: {}, run: () => this.finish('Fine. End your turn now.') },
    ];
  }
}

/** Runs the retrospective; its proposals are on the board once it settles. */
export async function retrospect(o: RuleRetroRun): Promise<void> {
  const { runtime, cwd, onLimit, ...rest } = o;
  await new RuleRetroJob(rest).run(runtime, { cwd, ...(onLimit ? { onLimit } : {}) });
}
