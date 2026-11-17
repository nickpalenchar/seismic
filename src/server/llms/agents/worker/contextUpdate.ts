/**
 * What the worker hears with a tool step's result while it works: the owner's words that waited for
 * it, news of the demo's page, new preferences, decisions taken in its plan, and that Seismic or the
 * owner still waits for it to pause. Each is told once.
 */
import type { Live, WorkerSupervisor } from '../../../workerSupervisor/workerSupervisor';
import { decisionLog } from '../../../advisor';
import { PAUSE_STILL, pauseOf, stillDue } from './restartNotices';

/** What these need of the `WorkerSupervisor` that runs the card. */
export type ContextHost = Pick<WorkerSupervisor, 'live' | 'o' | 'restart' | 'takeUnheard' | 'pageNews'>;

/**
 * The owner's words that waited for the worker's next step, passed with that step's result. A
 * tool result carries no images: the worker opens the screenshots' files itself.
 */
export function unheardNow(self: ContextHost, cardId: string, live: Live): string | undefined {
  if (self.live.get(cardId) !== live) return;
  const unheard = self.takeUnheard(cardId, false);
  if (!unheard.length) return;
  const images = unheard.flatMap((u) => u.images);
  return [...unheard.map((u) => u.text), ...(images.length ? [`The screenshots cannot come with a tool result: read their files to see them (${images.join(', ')}).`] : [])].join('\n\n---\n\n');
}

/** What became of the demo's page since the worker last heard of it, passed with its next tool result. */
export function pageNewsNow(self: ContextHost, cardId: string, live: Live): string | undefined {
  if (self.live.get(cardId) !== live) return;
  return self.pageNews(cardId);
}

/** Preferences the owner gave or changed since the worker last heard them, passed with its next tool result. */
export function preferencesUpdate(self: ContextHost, live: Live): string | undefined {
  const now = self.o.preferences?.() ?? '';
  if (now === live.preferences) return;
  live.preferences = now;
  return now ? `The owner's preferences changed while you work; they now read:\n\n${now}` : 'The owner withdrew their standing preferences; none apply any more.';
}

/** Decisions taken in the card's plan since the worker last heard of them, passed with its next tool result; those on its own card it heard as answers. */
export function decisionsUpdate(self: ContextHost, cardId: string, live: Live): string | undefined {
  if (!live.plan) return;
  const fresh = self.o.board.decisions(live.plan.id).filter((d) => d.id > live.plan!.decision);
  if (!fresh.length) return;
  live.plan.decision = fresh.at(-1)!.id;
  const others = fresh.filter((d) => d.cardId !== cardId);
  return others.length ? `Decisions taken in this plan while you work:\n${decisionLog(others)}` : undefined;
}

/**
 * A turn that starts after the worker paused for the restart, before it happened, hears once that
 * Seismic still waits: with its message, or with its first tool step when nothing of Seismic's started
 * it (a background command that finished, which the worker would otherwise go on from).
 */
export function restartStillDue(self: ContextHost, cardId: string, live: Live): string | undefined {
  if (!self.restart || !live.restartPaused) return;
  live.restartPaused = false;
  self.o.board.log(cardId, 'state', 'obeya', self.o.board.t.worker.restartStillDue(pauseOf(self.restart)));
  return stillDue(self.restart);
}

/** A turn that the worker's background work starts after it ended one for the owner's pause hears once, with its first tool step, that the owner still waits. */
export function pauseStillDue(live: Live): string | undefined {
  if (!live.pauseHeld) return;
  live.pauseHeld = false;
  return PAUSE_STILL;
}

/** Everything the worker hears with its next tool step's result, joined; none when there is nothing. */
export function workerContextUpdate(self: ContextHost, cardId: string, live: Live, reviewOnly: boolean): string | undefined {
  return (
    [restartStillDue(self, cardId, live), pauseStillDue(live), ...(!reviewOnly ? [pageNewsNow(self, cardId, live), unheardNow(self, cardId, live), decisionsUpdate(self, cardId, live)] : []), preferencesUpdate(self, live)]
      .filter(Boolean)
      .join('\n\n') || undefined
  );
}
