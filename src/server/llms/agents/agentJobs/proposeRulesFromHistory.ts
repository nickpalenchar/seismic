



import { z } from 'zod';
import type { Board } from '../../../board';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { proposeRulesFromHistorySystem } from '../../prompts/proposeRulesFromHistorySystem';
import { reposParam } from '../../prompts/whereRulesGo';
import { type JobRun, SeismicJob } from '../seismicJob';
import { ownerFacing, proposalTargets, ruleLines } from './ruleProposals';


export const RULE_RETRO_PROPOSALS = 3;

export interface ProposeRulesFromHistoryRun {
  runtime: AgentRuntime;
  board: Board;
  
  cwd: string;
  
  language: string;
  
  history: string[];
  onLimit?: JobRun['onLimit'];
}

/** Reads the history and proposes rules to the owner, who decides them on the board. */
class ProposeRulesFromHistoryJob extends SeismicJob {
  override readonly role = 'koordinator' as const;
  readonly name = 'proposeRulesFromHistory';
  readonly description = "Proposes rules for the patterns in what the owner did since the last retrospective.";
  private proposed = 0;
  
  private readonly rules;

  constructor(private o: Omit<ProposeRulesFromHistoryRun, 'runtime' | 'cwd' | 'onLimit'>) {
    super();
    this.rules = o.board.preferences('active');
  }

  protected answer() {
    return { value: undefined };
  }

  getPrompt() {
    return ownerFacing(this.o.board, proposeRulesFromHistorySystem(this.o.language, RULE_RETRO_PROPOSALS));
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

/** Proposes rules from what happened since the last retrospective; the proposals are on the board once it settles. */
export async function proposeRulesFromHistory(o: ProposeRulesFromHistoryRun): Promise<void> {
  const { runtime, cwd, onLimit, ...rest } = o;
  await new ProposeRulesFromHistoryJob(rest).run(runtime, { cwd, ...(onLimit ? { onLimit } : {}) });
}
