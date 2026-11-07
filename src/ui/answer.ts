// The owner's answer to an agent's questions: the options picked and their own words, as one text.

import type { Question } from '../core/types';

/**
 * One line per answered question (`**question** picks`), then the owner's own words: as in an
 * idea's conversation, which is read later without the questions beside it.
 */
export function answerText(questions: Question[], picks: string[][], words: string): string {
  const lines = questions.flatMap((q, i) => (picks[i]?.length ? [`**${oneLine(q.text)}** ${picks[i]!.join(', ')}`] : []));
  return [lines.join('\n'), words.trim()].filter(Boolean).join('\n\n');
}

/**
 * An answer `answerText` wrote, read back against the questions it may name: the answers given to
 * each question its lines name (its options picked, then the owner's own answer, which is no option
 * of it), and the owner's further words. A text that does not start with such lines, every one of
 * them naming one of `questions`, picked nothing.
 */
export function readAnswer(text: string, questions: Pick<Question, 'text' | 'options'>[]): { picks: (string[] | undefined)[]; words: string } {
  const none = { picks: [], words: text };
  const [lead = '', ...rest] = text.split('\n\n');
  const picks: (string[] | undefined)[] = [];
  for (const line of lead.split('\n')) {
    const i = questions.findIndex((q) => line.startsWith(`**${oneLine(q.text)}** `));
    const picked = i < 0 ? undefined : given(line.slice(oneLine(questions[i]!.text).length + 5), questions[i]!.options);
    if (!picked) return none;
    picks[i] = picked;
  }
  return { picks, words: rest.join('\n\n').trim() };
}

/** The answers `answerText` joined into `s`: the options it starts with, then the owner's own answer, if any is left. */
function given(s: string, options: string[]): string[] | undefined {
  if (!s.trim()) return undefined;
  const all = chosen(s, options);
  if (all) return all;
  const o = options.find((x) => s.startsWith(`${x}, `));
  return o ? [o, ...given(s.slice(o.length + 2), options.filter((x) => x !== o))!] : [s];
}

/** The options `answerText` joined into `s`, in any order; undefined if `s` is not made of them. */
function chosen(s: string, options: string[]): string[] | undefined {
  for (const o of options) {
    if (s === o) return [o];
    const more = s.startsWith(`${o}, `) && chosen(s.slice(o.length + 2), options.filter((x) => x !== o));
    if (more) return [o, ...more];
  }
  return undefined;
}

/** Picks one option: a single-choice question holds one (picking it again takes it back), a multiple-choice one any. */
export function toggle(q: Pick<Question, 'options' | 'multiple'>, picked: string[], option: string): string[] {
  if (picked.includes(option)) return picked.filter((o) => o !== option);
  return q.multiple ? q.options.filter((o) => o === option || picked.includes(o)) : [option];
}

/** The last choice of every question with options, picked like the others: the owner's own answer, written beside it. */
export const OTHER = '\u0000other';

/** Picks the owner's own answer like an option (`OTHER`), after the question's options. */
export const toggleOther = (q: Question, picked: string[], option: string) => toggle({ ...q, options: [...q.options, OTHER] }, picked, option);

/** The answers to each question: the options picked, and the owner's own answer (`others`) where its choice is picked and written. */
export function answers(picks: string[][], others: string[] = []): string[][] {
  return picks.map((p, i) => p.flatMap((o) => (o !== OTHER ? [o] : others[i]?.trim() ? [others[i]!.trim()] : [])));
}

/**
 * The owner's own answers, for an answer whose picks go apart from its text: each as its own
 * paragraph, named by its question where several stand, then the owner's further words.
 */
export function ownAnswers(questions: Question[], picks: string[][], others: string[], words: string): string {
  const own = questions.flatMap((q, i) => {
    const text = picks[i]?.includes(OTHER) ? others[i]?.trim() : '';
    return text ? [questions.length > 1 ? `**${oneLine(q.text)}** ${text}` : text] : [];
  });
  return [...own, words.trim()].filter(Boolean).join('\n\n');
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
