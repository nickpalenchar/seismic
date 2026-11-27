




import { z } from 'zod';
import { ownersLanguage } from '../../../../core/locale';
import type { Item, Revising } from '../../../../core/types';
import type { Board } from '../../../board';
import { imageNote } from '../../../images';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { toSeismicTool } from '../../../toSeismic';
import { workerConfig } from '../../../workerConfig';
import { reviseProposalSystem, toSeismicNote } from '../../prompts/reviseProposalSystem';
import { type JobRun, SeismicJob } from '../seismicJob';


export interface Revised {
  title: string;
  task: string;
  reason?: string;
  idea?: boolean;
  questions: { question: string; options?: string[]; multiple?: boolean }[];
  
  images?: string[];
  
  reply?: string;
}


export interface Shots {
  all: string[];
  said: string[];
  kept: string[];
  earlier: string[];
}

export interface ReviseProposalRun {
  runtime: AgentRuntime;
  board: Board;
  
  cwd: string;
  card: Item;
  said: Revising;
  shots: Shots;
  
  preferences?: string;
  
  toSeismic?: (request: string) => Promise<string>;
  
  images?: string[];
  onLimit?: JobRun['onLimit'];
}

/** Reworks a proposal by what the owner said about it; keeps the proposal it writes in `revised`, and in `passed` whether it passed words on to Seismic. */
class ReviseProposalJob extends SeismicJob<Revised | null> {
  override readonly role = 'koordinator' as const;
  readonly name = 'reviseProposal';
  readonly description = 'Reworks a proposal by what the owner said about it.';
  private revised: Revised | undefined;
  private passed = false;

  constructor(private o: Pick<ReviseProposalRun, 'board' | 'card' | 'said' | 'shots' | 'preferences' | 'toSeismic'>) {
    super();
  }

  protected answer() {
    return this.revised ? { value: this.revised } : this.passed ? { value: null } : undefined;
  }

  protected override missing() {
    return 'the agent gave no new text';
  }

  getPrompt() {
    return [reviseProposalSystem, this.o.toSeismic ? toSeismicNote : '', this.o.preferences ?? ''].filter(Boolean).join('\n\n');
  }

  async getBrief() {
    const { card, said, shots } = this.o;
    const p = card.idea!.proposal!;
    const from = card.from ? this.o.board.item(card.from) : undefined;
    const summary = from ? this.o.board.summary(from.id)?.trim() : undefined;
    return [
      `The proposal as it stands${p.idea ? ' (proposed as an idea)' : ''}:\n\n<title>${card.title}</title>\n\n<task>\n${card.body}\n</task>`,
      p.reason ? `Why it was proposed (for the owner only): ${p.reason}` : '',
      card.idea?.retro ? `The work retrospective proposed it, resting on: ${card.idea.retro}` : '',
      p.questions.length
        ? `Its questions to the owner:\n${p.questions.map((q) => `- ${q.text}${q.options.length ? ` (options: ${q.options.join(' / ')}${q.multiple ? '; several may be chosen' : ''})` : ''}`).join('\n')}`
        : 'It has no questions to the owner.',
      from ? `It came from the card "${from.title}"${summary ? `, whose worker handed over:\n\n${summary}` : '.'}` : '',
      `What the owner ${said.spoken ? 'said about it (speech recognition, may contain errors)' : 'wrote about it'}:\n\n<owner>\n${said.words}\n</owner>${imageNote(shots.said)}`,
      shots.all.length
        ? [
            shots.kept.length ? `Screenshots that go with the card's task now: ${shots.kept.join(', ')}.` : `No screenshot goes with the card's task now.`,
            shots.earlier.length ? `Screenshots the owner showed earlier in this conversation, which do not go with it: ${shots.earlier.join(', ')}.` : '',
            `All of them are shown below, in this order: ${shots.all.join(', ')}.`,
          ]
            .filter(Boolean)
            .join(' ')
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  getJobTools(): AgentTool[] {
    const { shots, toSeismic } = this.o;
    return [
      {
        name: 'revise_proposal',
        description: [
          `The whole proposal as it is to stand now, in the owner's language. ${ownersLanguage(this.o.board.conversation())}`,
          `title: short and precise. ${workerConfig.proposalTask('the card it came from nor this conversation')}`,
          `reason: for the owner only, why it is proposed, a sentence or two (keep it unless what the owner said changes it). idea: true for something to think through with the owner before anyone builds it.`,
          `questions: what the owner still has to decide, each with up to four short options; keep them out of task. A question the owner's words settle goes, and its decision goes into task.`,
          `reply: your turn in the conversation beside the proposal, a sentence or two for the owner: the answer to what they asked (asked which option you would take: your pick and why), and what you changed, without repeating the text.`,
          shots.all.length
            ? `images: the file names of the screenshots shown to you that go with the card's task, for the agent who takes it on to see: one that shows what the task is about goes; one the owner's words make obsolete, or that only went with a question you answered, does not. Leave it out to keep those that go with it now.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        schema: {
          title: z.string(),
          task: z.string(),
          reason: z.string().optional(),
          idea: z.boolean().optional(),
          questions: workerConfig.proposalQuestionsSchema,
          reply: z.string(),
          ...(shots.all.length ? { images: z.array(z.string()).optional() } : {}),
        },
        run: (r) => {
          if (this.revised) return 'Only the first one counts.';
          if (!String(r.title).trim() || !String(r.task).trim()) return 'Not recorded: title and task must not be empty.';
          this.revised = r as unknown as Revised;
          return this.finish('Recorded. End your turn now.');
        },
      },
      ...(toSeismic
        ? [
            toSeismicTool((request) => {
              this.passed = true;
              return toSeismic(request);
            }),
          ]
        : []),
    ];
  }
}

/** Reworks a proposal; gives null when the agent only passed the words on to Seismic, and throws with why the session gave none. */
export async function reviseProposal(o: ReviseProposalRun): Promise<Revised | null> {
  const { runtime, cwd, images, onLimit, ...rest } = o;
  const result = await new ReviseProposalJob(rest).run(runtime, { cwd, at: { card: o.card.id }, ...(images ? { images } : {}), ...(onLimit ? { onLimit } : {}) });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
