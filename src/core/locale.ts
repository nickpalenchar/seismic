// The languages Seismic speaks: the demo skill's, which runs without Seismic and so holds them.
import { type Language, LANGUAGE_NAMES } from '../../plugin/skills/demo/lib/locale.ts';

export { FALLBACK_LANGUAGE, LANGUAGE_NAMES, LANGUAGES, type Language, languageOf } from '../../plugin/skills/demo/lib/locale.ts';

/**
 * What a prompt tells an agent that talks with the owner about the language it writes them in
 * (design: Language): the chosen conversation language, or a standing language preference.
 * Its tools then say "in the owner's language".
 */
export const ownersLanguage = (conversation: Language, first?: string) =>
  `Speak to the owner in ${LANGUAGE_NAMES[conversation]} throughout this conversation, unless an explicit standing preference names another language. The task${first ? ` (${first})` : ''} and later messages may be written in another language; they do not change the language of your replies. What you write to the owner uses that language, also where what you work on is in another.`;

/** What a prompt tells an agent whose work lands in a repository (or a folder without git) about the language of what lands there. */
export const repositoryLanguage = (repository: Language, folder = false) =>
  `What you ${folder ? 'write into the folder' : 'commit'} (code, comments, ${folder ? '' : 'commit messages, '}docs, plan docs, CLAUDE.md) is in ${LANGUAGE_NAMES[repository]}, whatever language the owner talks to you in.`;
