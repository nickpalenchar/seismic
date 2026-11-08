// What the owner says or types reaches its target, and what they are told back, the same on the
// project and in the phone view: the confirmation with "Undo" above the microphone, words
// handed on to the agent of the open card or to the Koordinator, and what the microphone says it
// speaks to.

import { useRef } from 'react';
import type { Place } from '../core/layout';
import { agentListens, type Item, type TalkRef } from '../core/types';
import { api, ApiError, type Field, type Heard, type Where } from './api';
import { clip } from '../core/text';
import { excerpt, plain } from './markdown';
import { sent, take, videoOf } from './spot';
import { failText, t } from './strings';
import type { useTold } from './voice';
import type { ToastStore } from './components/toast';

/** How long a confirmation stays, and its "Undo" unless the action waits longer. */
export const ACK_MS = 7000;

/**
 * The confirmation above the microphone, one at a time, each taking the place of the one before:
 * `showAck` with "Undo" while the action still waits, `showWait` for what the server is still at,
 * `fail` for what went wrong.
 */
export function useAck(toasts: ToastStore) {
  /** A confirmation; with `undo`, "Undo" shows for `undoMs` (while the server still waits). */
  function showAck(text: string, undo?: () => unknown, undoMs = ACK_MS) {
    const id: number = toasts.show({
      slot: 'ack',
      kind: 'confirm',
      text,
      stayMs: ACK_MS,
      ...(undo
        ? {
            undo: () => {
              undo();
              toasts.remove(id);
            },
            undoMs: Math.max(0, undoMs - 400),
          }
        : {}),
    });
  }
  /** What went wrong, in place of the confirmation; what the server did not refuse also goes to the console. */
  function fail(e: unknown) {
    if (!(e instanceof ApiError)) console.error(e);
    showAck(failText(e));
  }
  /** What the server is still at: stays, turning, until a confirmation takes its place. */
  const showWait = (text: string) => void toasts.show({ slot: 'ack', kind: 'wait', text });
  return { showAck, showWait, fail };
}

/**
 * Warnings (a notice with `level: 'warning'`) as toasts that stay until dismissed, each with
 * "Go to card" where it is about a card; `show` adds one.
 */
export function useWarnings(toasts: ToastStore, goTo: (cardId: string) => void) {
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const show = (text: string, cardId?: string) =>
    void toasts.show({ kind: 'warning', text, dismiss: true, go: cardId ? [{ id: cardId, label: t.voice.goToCard, run: () => goToRef.current(cardId) }] : [] });
  return { show };
}

/**
 * A notice as the line above the microphone shows it: an answer looked up comes in Markdown, the
 * line shows it plain, on one line and cut short; the sheet or the card has it in full.
 */
export const noticeLine = (text: string) => clip(excerpt(text), 300);

/**
 * Hands words on: `byId` finds the cards they may be about, `told` keeps each command's line above
 * the microphone, `fail` says what went wrong, `place` is where a card a command makes goes.
 */
export function tellers(byId: (id: string) => Item | undefined, told: ReturnType<typeof useTold>, fail: (e: unknown) => void, place: () => Place | undefined) {
  /** The card `target` names, if any. */
  const cardIn = (target: Where) => (target && 'card' in target ? byId(target.card) : undefined);
  /** The card in `target` when an agent listens on it: what the owner says there goes straight to that agent. */
  const listening = (target: Where) => {
    const i = cardIn(target);
    return i && agentListens(i) ? i : undefined;
  };
  /** The card a command for `target` is about, named in its confirmation when another card is open by then. */
  const toldCard = (target: Where) => {
    const i = cardIn(target);
    return i ? { id: i.id, title: plain(i.title) } : undefined;
  };
  /**
   * Hands a spoken command for `target` on, with its line above the microphone: while Whisper writes
   * it down for the open card's agent, or while the Koordinator reads it.
   */
  const tellAbout = (target: Where, request: () => Promise<Heard>) => {
    const i = target ? byId('card' in target ? target.card : target.plan) : undefined;
    const what = i ? `„${plain(i.title)}“` : t.voice.koordinator;
    return told.tell(listening(target) ? t.voice.transcribing(what) : t.voice.reading(what), toldCard(target), request);
  };
  /**
   * Words typed on a card, in its idea or in the Koordinator's conversation: on a card an agent listens on
   * they go straight to it, else the Koordinator reads them like spoken ones. The conversation shows
   * them at once either way; above the mic only the Koordinator's confirmation shows, with "Undo".
   */
  const tellTyped = async (text: string, images: string[] | undefined, target: Where, field?: Field, replyTo?: number | TalkRef) => {
    if (listening(target))
      try {
        // typed while the card's demo video stands at a place: about that place, and the video plays on
        const taken = target && 'card' in target ? take(target.card) : null;
        if (taken) videoOf((target as { card: string }).card)?.play().catch(() => {});
        await api.command(text, target, { images, field, replyTo, spot: await sent(taken) });
      } catch (e) {
        fail(e);
      }
    else {
      const at = place();
      void told.tell(null, toldCard(target), () => api.command(text, target, { images, field, replyTo, ...(at ? { place: at } : {}) }));
    }
  };
  return { listening, tellAbout, tellTyped };
}

/** Whom the microphone speaks to: the open card (its agent, where one listens), the open plan, or the Koordinator. */
export function voiceTarget(open: { type: 'card' | 'plan'; item?: Item } | null): string {
  const i = open?.item;
  const title = plain(i?.title ?? '');
  if (open?.type === 'plan') return t.voice.plan(title);
  if (open?.type !== 'card') return t.voice.koordinator;
  if (!i || !agentListens(i)) return t.voice.card(title);
  return (i.kind === 'question' ? t.voice.question : i.state === 'idea' ? t.voice.idea : i.state === 'proposal' ? t.voice.proposal : t.voice.agent)(title);
}
