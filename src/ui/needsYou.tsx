// "Needs you": the cards that wait for the owner, docked on the right behind the floating row's bell.
// The shown project's cards come first, as the inbox lists them (newest wait first, snoozed ones at
// the end); every other project with cards waiting follows as a header with its count, folded until
// clicked open. "Hide other projects" leaves those headers out, remembered per browser. Each card is
// its inbox entry (src/ui/inbox.tsx): its face at size S, its one-click replies and "Go to card".
// Seismic's answers and rule or setting proposals are the inbox's alone.

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { counted, type InboxEntry } from '../core/inbox';
import type { Item } from '../core/types';
import { Docked } from './docked';
import { CardEntry, type InboxProps } from './inbox';
import { useStoredState } from './stored';
import { t } from './strings';

type CardOnly = InboxEntry & { card: Item };

export function NeedsYouSheet({ on, entries, current, open, onGo, onReply, isRead, onRead }: Omit<InboxProps, 'onProposalCard' | 'onProposalConfig' | 'els'> & { on: boolean; current: string }) {
  const [hideOthers, setHideOthers] = useStoredState<boolean>('obeya-needs-you-hide-others', false);
  // the other projects opened in this sheet, until the page reloads
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const cards = entries.filter((e): e is CardOnly => !!e.card);
  const here = cards.filter((e) => e.project === current);
  const others = [...new Set(cards.filter((e) => e.project !== current).map((e) => e.project))].map((project) => ({ project, entries: cards.filter((e) => e.project === project) }));
  const entry = (e: CardOnly) => (
    <CardEntry key={e.key} e={e} unread={!isRead(e)} here={e.project === current && e.card.id === open} current={current} onGo={onGo} onReply={onReply} onRead={onRead} />
  );
  return (
    <Docked id="needs-you" on={on} label={t.needsYou.title}>
      <h2>{t.needsYou.title}</h2>
      <div className="inbox-bar">
        <label className="inbox-all-projects">
          <input type="checkbox" role="switch" className="toggle" checked={hideOthers} onChange={(ev) => setHideOthers(ev.target.checked)} />
          {t.needsYou.hideOthers}
        </label>
      </div>
      {here.length ? <ul className="inbox-list">{here.map(entry)}</ul> : <p className="empty-inbox">{others.length ? t.needsYou.noneHere : t.needsYou.empty}</p>}
      {!hideOthers &&
        others.map(({ project, entries: list }) => {
          const open = unfolded.includes(project);
          const n = list.filter(counted).length;
          return (
            <section key={project} className="ny-project">
              <button
                type="button"
                className={open ? 'ny-head open' : 'ny-head'}
                aria-expanded={open}
                title={t.needsYou.project(list[0]!.projectName, n)}
                onClick={() => setUnfolded(open ? unfolded.filter((p) => p !== project) : [...unfolded, project])}
              >
                <ChevronRight size={14} strokeWidth={2} aria-hidden />
                <span className="ny-name">{list[0]!.projectName}</span>
                {n > 0 && <span className="n">{n}</span>}
              </button>
              {open && <ul className="inbox-list">{list.map(entry)}</ul>}
            </section>
          );
        })}
    </Docked>
  );
}
