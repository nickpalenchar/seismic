/**
 * What the exploration agent hears mid-session, with its next tool call: that the owner chose to build
 * the idea, and a preference that changed. Each reaches it once.
 */
import type { Live } from '../../../explorers';
import type { ExplorerHost } from './tools';

/** The owner clicked "Build it like this" during the agent's turn. */
const BUILD_AFTER_REPLY =
  'The owner clicked "Build it like this" while you worked on this reply: once it is there, a worker builds the idea from the brief as you leave it, unless your reply asks questions; then nothing is built, and the owner decides again after answering them.';

/** The owner clicked "Build it like this" while the agent works: it hears so once, as the brief it leaves becomes the task. */
export function buildNote(self: ExplorerHost, cardId: string, live: Live): string | undefined {
  if (live.toldBuild || !self.o.board.item(cardId)?.idea?.discussion?.buildAfterReply) return;
  live.toldBuild = true;
  return BUILD_AFTER_REPLY;
}

/** A preference learned or changed during the session reaches the agent once, with its next tool call. */
function preferencesUpdate(self: ExplorerHost, live: Live): string | undefined {
  const now = self.o.preferences?.() ?? '';
  if (now === live.preferences) return;
  live.preferences = now;
  return now ? `The owner's preferences changed during this conversation; they now read:\n\n${now}` : 'The owner withdrew their standing preferences; none apply any more.';
}

/** The note for the agent's next tool call, or none. */
export function explorerContextUpdate(self: ExplorerHost, cardId: string, live: Live): string | undefined {
  return [buildNote(self, cardId, live), preferencesUpdate(self, live)].filter(Boolean).join('\n\n') || undefined;
}
