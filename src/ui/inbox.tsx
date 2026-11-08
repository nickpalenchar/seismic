// The inbox: what waits for the owner on every project, newest first (src/core/inbox.ts). The
// desktop slides it out as a sheet from the bar's inbox button; the phone lists it as "Needs you".
// Each entry names its project small, its card large and what it waits for lighter ("Demo ready" on
// a handover, which is judged on the card); under it, the card's one-click replies
// (src/ui/quickReply.ts), only its default primary, and "Go to card", always there and never the
// primary one. Only a click on a button (the title included) reads an entry. Unread entries carry an orange dot and a bold title; the switch above the list shows
// all of them or only the unread ones (src/ui/inboxRead.ts keeps what was read).

import type { MouseEvent } from 'react';
import { GitBranch } from 'lucide-react';
import type { InboxEntry } from '../core/inbox';
import type { Item } from '../core/types';
import { ProposalRow, SettingRow } from './koordinator';
import { Docked } from './docked';
import { Inline, plain } from './markdown';
import { asksYou } from './parts';
import { OtherCanvas } from './canvases';
import { type QuickReply, quickReplies } from './quickReply';
import { useStoredState } from './stored';
import { clock, shortDay, stateLabel, t } from './strings';

/** When it began: the time today, else the day. */
export const when = (iso: string | number) => (new Date(iso).toDateString() === new Date().toDateString() ? clock(iso) : shortDay(iso));

export interface InboxProps {
  entries: InboxEntry[];
  /** The project shown now: without "All projects" only its entries are listed. Left out, every project's are. */
  current?: string;
  /** The card open now, or flying open: its entry is marked, and stays listed while read. */
  open?: string;
  onGo: (e: InboxEntry) => void;
  onReply: (project: string, i: Item, r: QuickReply) => void;
  onProposalCard: (project: string, i: Item) => void;
  onProposalConfig?: (project: string, repo: string, field: string) => void;
  /** Whether the owner has read the entry. */
  isRead: (e: InboxEntry) => boolean;
  /** The owner clicked on the entry: it is read. */
  onRead: (e: InboxEntry) => void;
}

type Filter = 'all' | 'unread';

/** The entries as a list, the same on the desktop's sheet and the phone. */
export function InboxList({ entries: all, current, open, onGo, onReply, onProposalCard, onProposalConfig, isRead, onRead }: InboxProps) {
  const [filter, setFilter] = useStoredState<Filter>('obeya-inbox-filter', 'unread');
  const [everywhere, setEverywhere] = useStoredState<boolean>('obeya-inbox-all-projects', false);
  const entries = current && !everywhere ? all.filter((e) => e.project === current) : all;
  if (!entries.length && !current) return <p className="empty-inbox">{t.inbox.empty}</p>;
  // the open card's entry stays while the owner is at it, read or not
  const shown = filter === 'all' ? entries : entries.filter((e) => !isRead(e) || (!!e.card && e.card.id === open));
  // only a click on a button reads the entry, not one on the text around it; read as the click
  // bubbles up, after the button's own action: read in the capture phase, the entry leaves the
  // "Unread" list before the click reaches its button, which then neither opens nor answers
  const readOnButton = (ev: MouseEvent, e: InboxEntry) => {
    const hit = (ev.target as Element).closest('button, a');
    if (hit?.tagName === 'BUTTON') onRead(e);
  };
  const dot = <span className="unread-dot" role="img" aria-label={t.inbox.unread} />;
  return (
    <>
      <div className="inbox-bar">
      <div className="seg inbox-filter" role="radiogroup" aria-label={t.inbox.filter}>
        {(['unread', 'all'] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} className={filter === f ? 'on' : undefined} onClick={() => setFilter(f)}>
            {f === 'all' ? t.inbox.all : t.inbox.unread}
          </button>
        ))}
      </div>
        {current && (
          <label className="inbox-all-projects">
            <input type="checkbox" role="switch" className="toggle" checked={everywhere} onChange={(ev) => setEverywhere(ev.target.checked)} />
            {t.inbox.allProjects}
          </label>
        )}
      </div>
      {!entries.length && <p className="empty-inbox">{t.inbox.empty}</p>}
      {!!entries.length && !shown.length && <p className="empty-inbox">{t.inbox.noneUnread}</p>}
      <ul className="inbox-list">
        {shown.map((e) => {
          const unread = !isRead(e);
          const cls = unread ? ' unread' : ' read';
          if (e.preference || e.setting) return (
            <li key={e.key} className={`inbox-entry proposal-entry${cls}`} onClick={(ev) => readOnButton(ev, e)}>
              <div className="where"><GitBranch size={12} aria-hidden /><span className="project">{e.projectName}</span>{unread && dot}</div>
              <ul className="prefs proposals">
                {e.preference && <ProposalRow p={e.preference} items={e.proposalItems ?? []} rules={e.rules ?? []} repos={e.repos ?? []} project={e.project} onOpen={(i) => onProposalCard(e.project, i)} />}
                {e.setting && <SettingRow p={e.setting} items={e.proposalItems ?? []} repo={e.repos?.find((r) => r.id === e.setting!.repo)} project={e.project} onOpen={(i) => onProposalCard(e.project, i)} onConfig={onProposalConfig ? () => onProposalConfig(e.project, e.setting!.repo, e.setting!.field) : undefined} />}
              </ul>
            </li>
          );
          const i = e.card;
          const replies = i ? quickReplies(i) : [];
          const here = !!i && i.id === open;
          return (
            <li key={e.key} className={`inbox-entry${cls}${here ? ' on' : ''}`} aria-current={here || undefined} onClick={(ev) => readOnButton(ev, e)}>
              <div className="where">
                <GitBranch size={12} strokeWidth={2} aria-hidden />
                <span className="project">{e.projectName}</span>
                {i && e.project === current && <OtherCanvas item={i} named />}
                <span className="since">{when(e.since)}</span>
              </div>
              <div className="ttl">
                {unread && dot}
                <button type="button" className="ttl-link" onClick={() => onGo(e)}>{i ? plain(i.title) : t.koordinator.title}</button>
              </div>
              <div className={i && asksYou(i) ? 'state asking' : i?.state === 'proposal' && (i.retro || i.proposal?.setup) ? 'state by-obeya' : 'state'}>
                {i ? stateLabel(i) : t.phone.obeyaAnswered}
                {i?.state === 'proposal' && i.retro && <span aria-hidden>✦</span>}
              </div>
              {e.text && <div className="text">{i ? <Inline md={e.text} /> : plain(e.text)}</div>}
              <div className="replies">
                {replies.map((r) => (
                  <button key={r.label} type="button" className={r.primary ? 'btn primary' : 'btn'} title={r.title} onClick={() => onReply(e.project, i!, r)}>
                    {r.label}
                  </button>
                ))}
                <button type="button" className="btn" onClick={() => onGo(e)}>
                  {i ? t.inbox.goToCard : t.inbox.goToObeya}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The desktop's inbox, a docked sheet on the right like Seismic's. */
export function Inbox({ on, ...p }: InboxProps & { on: boolean }) {
  return (
    <Docked id="inbox" on={on} label={t.inbox.title}>
      <h2>{t.inbox.title}</h2>
      <InboxList {...p} />
    </Docked>
  );
}
