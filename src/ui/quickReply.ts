





import { answerText } from './answer';
import { ApiError, api, cardsOn } from './api';
import { removeCard, restoreCard } from './clients/seismic';
import { ACK_MS } from './tell';
import { type CardAction, handedOver, type Item, openQuestions, type Question } from '../core/types';
import { plain } from './markdown';
import { failText, snoozeWhen, t } from './strings';

export interface QuickReply {
  label: string;
  
  send: (id: string, keepalive: boolean) => Promise<void>;
  
  ack: string;
  
  undo?: (id: string) => Promise<unknown>;
  
  held?: true;
  primary?: true;
  title?: string;
}


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
  if (i.idea?.superseded)
    return [
      { label: t.superseded.keep, send: act({ action: 'keep' }), ack: t.quick.kept, primary: true, title: t.superseded.keepHint },
      { label: t.superseded.remove, send: (id) => removeCard(id), ack: t.deleted(plain(i.title)), undo: (id) => restoreCard(id), title: t.superseded.removeHint },
    ];
  if (i.state === 'proposal') {
    
    const p = i.idea?.proposal;
    if (p?.revising || p?.acceptAfterRevision || p?.merge) return [];
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
  
  if (i.state !== 'waiting' || i.review?.landing || handedOver(i)) return [];
  const asked = openQuestions(i);
  return asked.length === 1 ? options(asked[0]!) : [];
}


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
