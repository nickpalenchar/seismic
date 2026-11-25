



import { z } from 'zod';
import type { Item } from '../../../../core/types';
import type { Board } from '../../../board';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { learnRuleFromInputSystem } from '../../prompts/learnRuleFromInputSystem';
import { reposParam } from '../../prompts/whereRulesGo';
import { type JobRun, SeismicJob } from '../seismicJob';
import { ownerFacing, proposalTargets, ruleLines } from './ruleProposals';






export type OwnerInput = 'answer' | 'note' | 'feedback' | 'idea' | 'command' | 'talk' | 'card';


export interface InputContext {
  
  question?: string;
  
  reply?: string;
  
  before?: string;
}


const INPUTS: Record<OwnerInput, string> = {
  answer: 'answer',
  note: 'note to the worker',
  feedback: 'feedback on the finished work',
  idea: 'words in the discussion of an idea',
  command: 'words to you, which you carried out',
  talk: 'question or remark to you',
  card: 'text of a card they wrote, the task for an agent',
};

export interface LearnRuleFromInputRun {
  runtime: AgentRuntime;
  board: Board;
  
  cwd: string;
  
  language: string;
  
  card: Item | null;
  kind: OwnerInput;
  text: string;
  context: InputContext;
  
  around: string[];
  onLimit?: JobRun['onLimit'];
}

/** Reads one input of the owner and proposes a rule where it holds a lasting preference, which the owner decides on the board. */
class LearnRuleFromInputJob extends SeismicJob {
  override readonly role = 'koordinator' as const;
  readonly name = 'learnRuleFromInput';
  readonly description = 'Proposes a rule where something the owner said holds a lasting preference.';
  private proposed = false;
  
  private readonly rules;
  private readonly open;

  constructor(private o: Omit<LearnRuleFromInputRun, 'runtime' | 'cwd' | 'onLimit'>) {
    super();
    this.rules = o.board.preferences('active');
    this.open = o.board.preferences('proposed');
  }

  protected answer() {
    return { value: undefined };
  }

  getPrompt() {
    return ownerFacing(this.o.board, learnRuleFromInputSystem(this.o.language));
  }

  async getBrief() {
    const { board, card, kind, text, context, around } = this.o;
    const { question, reply, before } = context;
    return [
      card ? `Card${kind === 'talk' || kind === 'command' ? ' the owner had open' : ''}: ${card.kind === 'plan' ? 'plan ' : ''}"${card.title}".` : '',
      ...around,
      question ? `The worker asked: ${question}` : '',
      before ? `Before the owner wrote in it, the card's text read:\n${before}` : '',
      `The owner's ${INPUTS[kind]}: ${text}`,
      reply ? `You replied: ${reply}` : '',
      ...ruleLines(board, card),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  getJobTools(): AgentTool[] {
    const { board, card, text, language } = this.o;
    return [
      {
        name: 'propose',
        description: `Propose a lasting preference to the owner as one short rule in ${language}. Pass replaces with the number of a recorded rule it refines or contradicts. ${reposParam}`,
        schema: { rule: z.string(), replaces: z.number().int().optional(), repos: z.array(z.string()).optional() },
        run: ({ rule, replaces, repos }) => {
          const r = String(rule).trim().slice(0, 500);
          if (!r) return this.finish('Empty rule ignored.');
          if (this.proposed) return this.finish('One proposal per input. End your turn now.');
          const targets = proposalTargets(board, repos);
          if (typeof targets === 'string') return targets;
          const fresh = targets.filter((t) => !this.open.some((p) => p.text === r && p.target === t));
          if (!fresh.length) return this.finish('Already proposed. End your turn now.');
          const old = typeof replaces === 'number' ? this.rules[replaces - 1] : undefined;
          for (const t of fresh) board.proposePreference(r, { ...(card ? { cardId: card.id } : {}), quote: text }, old?.id, t);
          this.proposed = true;
          if (card) board.log(card.id, 'state', 'koordinator', board.t.koordinator.proposes(r));
          return this.finish('Proposed. End your turn now.');
        },
      },
      { name: 'nothing', description: 'Nothing lasting to record.', schema: {}, run: () => this.finish('Fine. End your turn now.') },
    ];
  }
}

/** Learns a rule from one input; its proposal, if any, is on the board once it settles. */
export async function learnRuleFromInput(o: LearnRuleFromInputRun): Promise<void> {
  const { runtime, cwd, onLimit, ...rest } = o;
  await new LearnRuleFromInputJob(rest).run(runtime, { cwd, ...(onLimit ? { onLimit } : {}) });
}
