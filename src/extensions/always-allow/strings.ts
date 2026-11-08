// What “Always allow” says on the card.

import type { Language } from '../../core/locale';

const en = {
  option: (rules: string[]) => `Always allow: ${rules.join(', ')}`,
  where: '“Always allow” adds the rule to the repository’s allow list (.claude/settings.json on main, for Claude and Codex), so no agent asks for it again.',
  added: (rules: string[], branch?: string) => `Added to the allow list${branch ? ` and committed on ${branch}` : ''}: ${rules.join(', ')}`,
  already: (rules: string[]) => `Already in the allow list: ${rules.join(', ')}`,
  failed: (rules: string[], why: string) => `Allowed once; ${rules.join(', ')} could not be added to the allow list: ${why}`,
};

export const STRINGS: Record<Language, typeof en> = { en };

/** `pick`'s text in every language. */
export const inEvery = (pick: (s: typeof en) => string): Record<Language, string> => ({ en: pick(en) });
