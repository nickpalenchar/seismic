// A card made from a conversation, set apart from what is said: an action with the card's live
// cover, in a card's conversation (a proposal, a follow-up) and in Seismic's chat (a task or idea it
// created). One component, so both look and open the card the same way.

import { SquarePlus } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { Item } from '../core/types';
import { api, onCardEvent, onReconnect, projectOf } from './api';
import { cardPath } from './address';
import { CardFace, cardClass } from './card';
import { plain } from './markdown';
import { Msg } from './message';
import { t } from './strings';

/** The card made: its id, its title then, and the project it went onto when that is another. */
export interface MadeRef {
  card: string;
  title: string;
  project?: string;
}

/**
 * The action, as a compact cover that opens the card by its address (in place, as a card named in
 * a text does; a modifier click in a tab of its own). A card on another project opens there; one
 * gone from the project shows its title, not a link. `what`: the action's words after the author,
 * given the card as far as it is known; `watch`: a card whose events may change the one made (the
 * one it was proposed on), so the cover of a card on another project is read again then.
 */
export function MadeCover({ made, who, what, at, ev, fresh, items, open, watch }: {
  made: MadeRef;
  who: string;
  what: (card: Item | undefined) => string;
  at?: string;
  ev?: number | string;
  fresh?: boolean;
  items: Item[];
  open: (i: Item) => void;
  watch?: string;
}) {
  const [elsewhere, setElsewhere] = useState<Item | null>();
  // A card on another project can change there (a proposal accepted or withdrawn). Read it again
  // when the watched card's conversation changes, and when returning from another tab.
  useEffect(() => {
    if (!made.project) return;
    let active = true;
    let latest = 0;
    const refresh = () => {
      const request = ++latest;
      return api.project(made.project!).then(
        (snapshot) => { if (active && request === latest) setElsewhere(snapshot.items.find((i) => i.id === made.card) ?? null); },
        () => { if (active && request === latest) setElsewhere(null); },
      );
    };
    void refresh();
    const events = onCardEvent((event) => { if (watch && event.cardId === watch) void refresh(); });
    const reconnect = onReconnect(refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; events(); reconnect(); window.removeEventListener('focus', refresh); };
  }, [made.project, made.card, watch]);
  const card = made.project ? elsewhere ?? undefined : items.find((i) => i.id === made.card);
  const head: ReactNode = (
    <>
      <SquarePlus className="action-mark" size={13} strokeWidth={1.75} aria-hidden="true" />
      {who} · {what(card)}
    </>
  );
  return (
    <Msg by="obeya" className={['action', fresh && 'fresh'].filter(Boolean).join(' ')} who={head} at={at} ev={ev}>
      {card && !card.archivedAt ? (
        <a
          className={`${cardClass(card)} cover`}
          href={cardPath(made.project ?? projectOf(card.id), card)}
          onClick={(m) => {
            if (made.project || m.button || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
            m.preventDefault();
            open(card);
          }}
        >
          <CardFace item={card} />
        </a>
      ) : (
        <div className="card cover gone">
          <div className="ttl">{plain(made.title)}</div>
          <div className="meta">{made.project && elsewhere === undefined ? t.talk.madeElsewhere : t.talk.madeGone}</div>
        </div>
      )}
    </Msg>
  );
}
