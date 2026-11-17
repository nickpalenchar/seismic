/**
 * Texts and small helpers the worker's tools and `Workers` share.
 */
import { z } from 'zod';
import { type Snooze } from '../../../../core/types';
import { type Asked, toQuestion, withPick } from '../../../advisor';
import { MESSAGES } from '../../../../core/messages';
import type { Demo } from '../../../../core/types';
import type { LandedState } from '../../../workers';

/** What the card's row stores while landed work's worker finishes; null while nothing has landed. */
export const landedOf = (row: { landed: string | null }): LandedState | null => (row.landed ? (JSON.parse(row.landed) as LandedState) : null);

/** The questions of a proposal (`propose_card`, `revise_proposal`) as the agent gives them. */
export const PROPOSAL_QUESTIONS = z.array(z.object({ question: z.string(), options: z.array(z.string()).max(4).optional(), multiple: z.boolean().optional() })).max(5);

/** The questions of a proposal as the card holds them. */
export const proposalQuestions = (questions: z.infer<typeof PROPOSAL_QUESTIONS> = []) => questions.map((q) => toQuestion(q.question, q.options, q.multiple));

export const proposalTask = (unseen: string) =>
  `task: the card's text, written for the agent who will take it on, which has seen neither ${unseen}: what is wrong or wanted, where (files, names), what done looks like. Write it as the owner would write a card: no "I", no "my question", no "your card"; name other cards by their title.`;

/** An app's address as app_running takes it. */
export const APP_URL = /^https?:\/\/[^\s/]+/i;

/** The question of a demo report as the demo keeps it: its text, options and the worker's pick, as `ask` takes them. */
export function demoQuestion(q: { text: string } & Omit<Asked, 'question'>): Pick<Demo, 'question' | 'options' | 'multiple' | 'pick'> {
  const { text, options, multiple, pick } = withPick({ ...q, question: q.text });
  return { question: text, ...(options.length ? { options } : {}), ...(multiple ? { multiple } : {}), ...(pick ? { pick } : {}) };
}

/** How many files a worker may name as its result at a handover. */
export const MAX_RESULT_FILES = 12;

export const END_TURN = 'Recorded. End your turn now without further work; the reply arrives as your next message.';

/** Until when a worker snoozed, as it hears it: a time, or the card it waits on (and the time at the latest). */
export function snoozedUntil(s: Snooze): string {
  const at = s.until ? MESSAGES.en.at(Date.parse(s.until)) : '';
  if (!s.on) return at;
  const what = s.on.state === 'done' ? 'is done (its work on main, or the card closed without a change)' : 'waits for the owner (a question or a handover)';
  return `the card “${s.on.title}” ${what}${at ? `, or ${at} at the latest` : ''}`;
}

export const AFTER_LANDING =
  'Your workstation and this session stay until you end a turn with nothing left to wait for (a question, the restart); then both end. Commits you make here no longer land.';
