/**
 * What the sessions that propose rules to the owner (the learner and the retrospective) share: the
 * context they read the rules with, and the repositories a rule may name.
 */
import type { Item, Preference } from '../../../../core/types';
import type { Board } from '../../../board';

/** The project's repositories and the rules so far, as the sessions that propose rules read them; `card` is the one open, if any. */
export function ruleLines(board: Board, card: Item | null): string[] {
  const repo = card?.repo ?? board.home;
  const rules = board.preferences('active');
  const where = (p: Preference) => (p.target ? ` (for the CLAUDE.md of ${p.target})` : '');
  const list = (ps: Preference[]) => ps.map((p) => `- ${p.text}${where(p)}`).join('\n');
  const [open, filed, rejected] = [board.preferences('proposed'), board.preferences('filed'), board.preferences('rejected')];
  return [
    `The project's repositories (ids for repos):\n${board.project.repos.map((r) => `- ${r.id}: ${r.name}, at ${r.path}${r.id === repo ? (card ? " (the card's)" : ' (the home repository)') : ''}`).join('\n')}`,
    rules.length ? `Rules recorded so far:\n${rules.map((r, n) => `${n + 1}. ${r.text}`).join('\n')}` : 'No rules recorded so far.',
    filed.length ? `Rules the owner accepted for a repository's CLAUDE.md (in it or on their way; do not propose them again):\n${list(filed)}` : '',
    open.length ? `Proposals waiting for the owner (do not propose them again):\n${list(open)}` : '',
    rejected.length ? `Proposals the owner rejected (do not propose them again):\n${list(rejected)}` : '',
  ];
}

/** The repositories a proposal goes to (none for the preference memory), or why the ids it named are not right. */
export function proposalTargets(board: Board, repos: unknown): (string | undefined)[] | string {
  const ids = Array.isArray(repos) ? [...new Set(repos.map(String).filter(Boolean))] : [];
  const known = board.project.repos.map((r) => r.id);
  const unknown = ids.filter((id) => !known.includes(id));
  if (unknown.length) return `Unknown repository ${unknown.join(', ')}; the project has ${known.join(', ')}. Call propose again.`;
  return ids.length ? ids : [undefined];
}

/** The instructions of such a session with the owner's standing preferences after them. */
export function ownerFacing(board: Board, system: string): string {
  const preferences = board.preferencesText();
  return preferences ? `${system}\n\n${preferences}` : system;
}
