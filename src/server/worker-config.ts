/**
 * What the worker's tools, its briefing and `Workers` agree on: limits, the texts a tool answers
 * with, and the small readers and formatters of what the worker is told. A class with one default
 * instance (`workerConfig`), so a caller that is handed one can be given another.
 */
import { z } from 'zod';
import { MESSAGES } from '../core/messages';
import type { Demo, Snooze } from '../core/types';
import { type Asked, toQuestion, withPick } from './advisor';
import type { LandedState } from './workers';

export class WorkerConfig {
  /** How many files a worker may name as its result at a handover. */
  readonly maxResultFiles = 12;

  /** An app's address as app_running takes it. */
  readonly appUrl = /^https?:\/\/[^\s/]+/i;

  /** What a tool answers with when the worker is to end its turn and wait for the reply. */
  readonly endTurn = 'Recorded. End your turn now without further work; the reply arrives as your next message.';

  /** What the worker hears once its work has landed and it still has things to wait for. */
  readonly afterLanding =
    'Your workstation and this session stay until you end a turn with nothing left to wait for (a question, the restart); then both end. Commits you make here no longer land.';

  /** The questions of a proposal (`propose_card`, `revise_proposal`) as the agent gives them. */
  readonly proposalQuestionsSchema = z.array(z.object({ question: z.string(), options: z.array(z.string()).max(4).optional(), multiple: z.boolean().optional() })).max(5);

  /** What the card's row stores while landed work's worker finishes; null while nothing has landed. */
  readonly landedOf = (row: { landed: string | null }): LandedState | null => (row.landed ? (JSON.parse(row.landed) as LandedState) : null);

  /** The questions of a proposal as the card holds them. */
  readonly proposalQuestions = (questions: z.infer<typeof this.proposalQuestionsSchema> = []) => questions.map((q) => toQuestion(q.question, q.options, q.multiple));

  /** How an agent writes a proposal's task, for the agent who takes it on and has not seen `unseen`. */
  readonly proposalTask = (unseen: string) =>
    `task: the card's text, written for the agent who will take it on, which has seen neither ${unseen}: what is wrong or wanted, where (files, names), what done looks like. Write it as the owner would write a card: no "I", no "my question", no "your card"; name other cards by their title.`;

  /** The question of a demo report as the demo keeps it: its text, options and the worker's pick, as `ask` takes them. */
  readonly demoQuestion = (q: { text: string } & Omit<Asked, 'question'>): Pick<Demo, 'question' | 'options' | 'multiple' | 'pick'> => {
    const { text, options, multiple, pick } = withPick({ ...q, question: q.text });
    return { question: text, ...(options.length ? { options } : {}), ...(multiple ? { multiple } : {}), ...(pick ? { pick } : {}) };
  };

  /** Until when a worker snoozed, as it hears it: a time, or the card it waits on (and the time at the latest). */
  readonly snoozedUntil = (s: Snooze): string => {
    const at = s.until ? MESSAGES.en.at(Date.parse(s.until)) : '';
    if (!s.on) return at;
    const what = s.on.state === 'done' ? 'is done (its work on main, or the card closed without a change)' : 'waits for the owner (a question or a handover)';
    return `the card “${s.on.title}” ${what}${at ? `, or ${at} at the latest` : ''}`;
  };
}

export const workerConfig = new WorkerConfig();
