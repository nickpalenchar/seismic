// Seismic's suggestion of a card's labels (design: The project): the plugin's labels skill guides the
// short session that judges them, as part of the naming call or a call of its own at the start.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CATEGORIES,
  COMPLEXITIES,
  type Label,
  LABEL_NAMES,
  type Labels,
  PRIORITIES,
  PRIORITY_NAMES,
  SUBCATEGORIES,
} from '../core/labels';
import { OBEYA_PLUGIN } from './demo';

/** The labels skill's file in Seismic's plugin. */
export const LABELS_SKILL_FILE = join(OBEYA_PLUGIN, 'skills', 'labels', 'SKILL.md');

let guide: string | undefined;
/** The skill's instructions without their front matter, for a session's system prompt. */
export function labelsGuide(): string {
  return (guide ??= readFileSync(LABELS_SKILL_FILE, 'utf8')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .trim());
}

const names = <K extends string>(keys: readonly K[], of: Record<K, string>) => keys.map((k) => of[k]) as [string, ...string[]];
const keyOf = <K extends string>(keys: readonly K[], of: Record<K, string>, name: unknown) =>
  keys.find((k) => of[k].toLowerCase() === String(name).trim().toLowerCase());

/** The tool parameters that ask for these labels, by the names the skill uses. */
export function labelParams(asked: Label[]): z.ZodRawShape {
  const all = {
    category: z.enum(names(CATEGORIES, LABEL_NAMES)),
    subcategory: z.enum(names(SUBCATEGORIES, LABEL_NAMES)),
    complexity: z.number().describe(`One of ${COMPLEXITIES.join(', ')}`),
    priority: z.enum(names(PRIORITIES, PRIORITY_NAMES)),
  };
  return Object.fromEntries(asked.map((l) => [l, all[l].optional()]));
}

/** The labels a tool call gave, of those asked; a value off the lists is left out. */
export function labelsFrom(a: Record<string, unknown>, asked: Label[]): Labels {
  const out: Labels = {};
  const category = keyOf(CATEGORIES, LABEL_NAMES, a.category);
  const subcategory = keyOf(SUBCATEGORIES, LABEL_NAMES, a.subcategory);
  const priority = keyOf(PRIORITIES, PRIORITY_NAMES, a.priority);
  const complexity = COMPLEXITIES.find((c) => c === Number(a.complexity));
  if (asked.includes('category') && category) out.category = category;
  if (asked.includes('subcategory') && subcategory) out.subcategory = subcategory;
  if (asked.includes('complexity') && complexity) out.complexity = complexity;
  if (asked.includes('priority') && priority) out.priority = priority;
  return out;
}

const LABEL_WORDS: Record<Label, string> = { category: 'category', subcategory: 'sub-category', complexity: 'complexity', priority: 'priority' };
/** "category, complexity and priority": the labels asked for, in a sentence. */
export const labelWords = (asked: Label[]) => {
  const w = asked.map((l) => LABEL_WORDS[l]);
  return w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w.at(-1)}` : (w[0] ?? '');
};
