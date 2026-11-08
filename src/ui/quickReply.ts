// One-click replies on the entries of "Needs you" (the navigation's list, the phone's): the decision
// the card's own buttons make, without opening the card. Of an entry's replies exactly one is the
// default, as on the card; what only the card can settle (a handover, judged by its demo; an idea's
// reply, several questions, a choice of many or several options, a proposal with questions of its
// own, a pull request waiting for its merge) has none. A reply that sets work in motion waits out an undo before it is sent.

import { answerText } from './answer';
import { ApiError, api, cardsOn } from './api';
import { ACK_MS } from './tell';
import { type CardAction, handedOver, type Item, openQuestions, type Question } from '../core/types';
import { plain } from './markdown';
import { failText, snoozeWhen, t } from './strings';

export interface QuickReply {
  label: string;
  /** What the click does to the card `id`; `keepalive` when it is sent as the page goes. */
  send: (id: string, keepalive: boolean) => Promise<void>;
  /** The confirmation. */
  ack: string;
  /** Taking it back afterwards, where the card's own button offers that (a removal). */
  undo?: (id: string) => Promise<unknown>;
  /** Sent only once its undo has run out (or the page closes), as it sets work in motion. */
  held?: true;
  primary?: true;
  title?: string;
}

/** Options that fit as buttons on an entry; a longer choice is made on the card. */
export const QUICK_OPTIONS = 4;

const act = (a: CardAction) => (id: string, keepalive: boolean) => api.act(id, a, keepalive);

/** The single question's options as replies, the one its agent would pick the default; none where it is not one click. */
function options(q: Question): QuickReply[] {
  if (q.multiple || q.stuck || !q.options.length || q.options.length > QUICK_OPTIONS) return [];
  const pick = q.pick?.options.length === 1 ? q.pick.options[0] : undefined;
  return q.options.map((o) => ({
    label: o,
    send: act({ action: 'answer', text: answerText([q], [[o]], ''), picks: [o] }),
    ack: t.quick.answered(o),
    held: true,
    ...(o === pick ? { primary: true as const, title: t.quick.pickHint } : {}),
  }));
}

/** The replies an entry offers for its card `i`. */
export function quickReplies(i: Item): QuickReply[] {
  if (i.superseded)
    return [
      { label: t.superseded.keep, send: act({ action: 'keep' }), ack: t.quick.kept, primary: true, title: t.superseded.keepHint },
      { label: t.superseded.remove, send: (id) => api.remove(id), ack: t.deleted(plain(i.title)), undo: (id) => api.restore(id), title: t.superseded.removeHint },
    ];
  if (i.state === 'proposal') {
    // a merged pair is approved or separated on the card, where the merged text shows
    if (i.proposal?.revising || i.proposal?.acceptAfterRevision || i.proposal?.merge) return [];
    const p = i.proposal;
    const later = !p?.idea && !!p?.startAt;
    const accept: QuickReply[] = openQuestions(i).length
      ? []
      : [
          {
            label: p?.idea ? t.acceptIdea : later ? t.acceptOnly : t.accept,
            send: act({ action: 'accept' }),
            ack: p?.idea ? t.acceptedIdea : later && Date.parse(p.startAt!) > Date.now() ? t.acceptedLater(snoozeWhen(p.startAt!)) : t.accepted,
            held: true,
            primary: true,
          },
        ];
    return [...accept, { label: t.dismiss, send: act({ action: 'dismiss' }), ack: t.dismissed, held: true }];
  }
  // a handover is judged by its demo, on the card; a question waiting there is its decision
  if (i.state !== 'waiting' || i.landing || handedOver(i)) return [];
  const asked = openQuestions(i);
  return asked.length === 1 ? options(asked[0]!) : [];
}

/** A reply on its way: the card's mark that it is under way (`null` takes it off), and the lines above the microphone. */
export interface ReplyUi {
  mark: (id: string, what: string | null) => void;
  showAck: (text: string, undo?: () => unknown, undoMs?: number) => void;
}

/**
 * Sends `r` for the card `i` on the project `project`: its entry leaves the list at once and comes back
 * with the reason if the server refuses; a held one goes out once its undo has run out.
 */
export function sendReply(project: string, i: Item, r: QuickReply, ui: ReplyUi) {
  cardsOn(project, [i.id]);
  const title = plain(i.title);
  ui.mark(i.id, r.label);
  const refused = (e: unknown) => {
    if (!(e instanceof ApiError)) console.error(e);
    ui.mark(i.id, null);
    ui.showAck(t.cardError(title, failText(e)));
  };
  const go = (keepalive: boolean) => {
    return r.send(i.id, keepalive).then(() => {
      if (!r.held) ui.showAck(r.ack, r.undo && (() => r.undo!(i.id)));
    }, refused);
  };
  if (!r.held) return void go(false);
  let sent = false;
  const fire = (keepalive: boolean) => {
    if (sent) return;
    sent = true;
    clearTimeout(timer);
    removeEventListener('pagehide', away);
    void go(keepalive);
  };
  const away = () => fire(true);
  const timer = setTimeout(() => fire(false), ACK_MS);
  addEventListener('pagehide', away);
  ui.showAck(r.ack, () => {
    if (sent) return;
    sent = true;
    clearTimeout(timer);
    removeEventListener('pagehide', away);
    ui.mark(i.id, null);
  });
}
