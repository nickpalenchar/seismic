/**
 * What the exploration agent is told when its session starts from scratch: the card, the decisions,
 * and for an idea discussed before (its session gone) where it stands.
 */
import type { CardEvent, Item } from '../../../../core/types';
import { clip } from '../../../../core/text';
import { decisionLog } from '../../../advisor';
import type { ExplorerHost } from './tools';
import { MAX_VARIANTS } from './tools';

/** What the briefing reads of the `Explorers` that runs the idea. */
export type BriefingHost = Pick<ExplorerHost, 'o'>;

/** How many messages of the conversation so far a session from scratch reads. */
const EARLIER_MESSAGES = 20;

/** A prototype's state, as a session from scratch hears it. */
function prototypeState(p: Item): string {
  if (p.idea?.prototypeEnd === 'discarded') return 'discarded';
  if (p.idea?.prototypeEnd === 'built') return 'the idea was built on it';
  if (p.state === 'planned' || p.state === 'working') return 'being built';
  if (p.state === 'waiting' && (p.need === 'demo' || p.need === 'review')) return 'handed over';
  return p.state;
}

/**
 * The first message of a session from scratch: the card and the decisions, and for an idea discussed
 * before (its session gone, pruned after weeks, say) where it stands: the brief, its mocks, the
 * prototypes planned and built, and the conversation so far up to the messages this turn answers (`said`).
 */
export function explorerBriefing(self: BriefingHost, card: Item, shots: string[], said: number[] = []): string {
  return [
    `The idea: “${card.title}”.`,
    card.body.trim(),
    shots.length ? `The owner attached ${shots.length === 1 ? 'a screenshot' : `${shots.length} screenshots`} to the card (shown with this message; files: ${shots.join(', ')}).` : '',
    `Decisions on cards without a plan so far:\n${decisionLog(self.o.board.decisions(null))}`,
    standing(self, card, said),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Where an idea discussed before stands, for a session that starts without its earlier ones; empty
 * for an idea its agent has not taken up yet (new, or a Question card just turned into one).
 */
function standing(self: BriefingHost, card: Item, said: number[]): string {
  const { brief, mocks = [], variants = [], split } = self.o.board.idea(card.id);
  const repo = card.idea?.newRepo;
  // in the order the agent read them: words it read later stand after the reply it read them at
  const place = (e: CardEvent) => (e.readAfter ? e.readAfter + 0.5 : e.id);
  const talk = self.o.board
    .talkOf(card.id, EARLIER_MESSAGES + said.length)
    .filter((e) => !said.includes(e.id))
    .slice(-EARLIER_MESSAGES)
    .sort((a, b) => place(a) - place(b) || a.id - b.id);
  const prototypes = card.idea?.prototypes ?? [];
  const shown = prototypes.slice(-MAX_VARIANTS);
  if (!brief.trim() && !mocks.length && !variants.length && !split && !repo && !prototypes.length && !talk.some((e) => e.author === 'explorer')) return '';
  const who = (e: CardEvent) => (e.author === 'owner' ? 'Owner' : e.author === 'explorer' ? 'You' : 'Seismic');
  return [
    'This idea was discussed before, in a session of yours that is gone. Where it stands, as Seismic keeps it; go on from there, and keep in the brief what still holds:',
    brief.trim() ? `The brief as you left it:\n\n${brief.trim()}` : '',
    mocks.length ? `The brief's mocks, shown under it (update_brief without mocks keeps them): ${mocks.map((m) => `“${m.title}”`).join(', ')}.` : '',
    variants.length ? `The prototypes you planned (plan_prototypes):\n${variants.map((v) => `- ${v.approach}: ${v.show}`).join('\n')}` : '',
    split ? `The part you marked to split off (plan_split): “${split.title}”.\n\n${split.brief}` : '',
    repo ? `It is to be built in a new repository at ${repo.path || '(no folder named yet)'}${repo.project ? ', with a project of its own' : ' on this project'}, as ${repo.by === 'owner' ? 'the owner picked on the card' : 'you marked with plan_repo'}.` : '',
    shown.length
      ? `The idea's prototypes${prototypes.length > shown.length ? ` (the latest ${shown.length} of ${prototypes.length})` : ''}:\n${shown.map((p) => `- “${p.title}”, ${prototypeState(p)}${p.review?.summary ? `. Its summary: ${clip(p.review.summary, 2000)}` : ''}`).join('\n')}`
      : '',
    talk.length
      ? `The conversation so far${talk.length === EARLIER_MESSAGES ? ' (its latest messages)' : ''}:\n\n${talk.map((e) => `${who(e)}${e.kind === 'question' ? ' (question)' : ''}: ${clip(e.text, 2000)}`).join('\n\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
