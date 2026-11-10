// The inbox: what waits for the owner on every project, newest first (src/core/inbox.ts). The
// desktop shows it as a full-page view of the main area, opened from the left menu's "Inbox", its
// list at the left, where a card opened from it unfolds beside the list; the phone lists it as
// "Needs you". The desktop's "Needs you" sheet (src/ui/needsYou.tsx) shows its cards' entries alike.
// Each card's entry is its face at size S (src/ui/card), its project and canvas on its top line and
// what it waits for under its state ("Demo ready" on a handover, which is judged on the card);
// under it, the card's one-click replies
// (src/ui/quickReply.ts), only its default primary, and "Go to card", always there and never the
// primary one. Only a click on a button (the title included) reads an entry. Unread entries carry an orange dot and a bold title; the switch above the list shows
// all of them or only the unread ones (src/ui/inboxRead.ts keeps what was read).

import type { MouseEvent, ReactNode } from 'react';
import { GitBranch, X } from 'lucide-react';
import type { InboxEntry } from '../core/inbox';
import type { Item } from '../core/types';
import { ProposalRow, SettingRow } from './koordinator';
import { FullPage } from './fullPage';
import { Inline, plain } from './markdown';
import { OtherCanvas } from './canvases';
import { CardFace, shownTitle, UnreadDot } from './card';
import { type QuickReply, quickReplies } from './quickReply';
import { useStoredState } from './stored';
import { clock, shortDay, t } from './strings';

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
  /** Where a card opened from its entry unfolds from and folds back to. */
  els?: Map<string, HTMLElement>;
}

/**
 * Only a click on a button reads the entry, not one on the text around it; read as the click
 * bubbles up, after the button's own action: read in the capture phase, the entry leaves the
 * "Unread" list before the click reaches its button, which then neither opens nor answers.
 */
const readOnButton = (ev: MouseEvent, read: () => void) => {
  const hit = (ev.target as Element).closest('button, a');
  if (hit?.tagName === 'BUTTON') read();
};

/** A card's entry: its face at size S with what it waits for, its one-click replies and "Go to card"; the open card's is ringed. */
export function CardEntry({ e, unread, here, current, onGo, onReply, onRead, els }: { e: InboxEntry & { card: Item }; unread: boolean; here: boolean; current?: string; onGo: (e: InboxEntry) => void; onReply: InboxProps['onReply']; onRead: (e: InboxEntry) => void; els?: Map<string, HTMLElement> }) {
  const i = e.card;
  return (
    <li
      ref={els ? (el) => void (el ? els.set(i.id, el) : els.delete(i.id)) : undefined}
      className={`inbox-entry${unread ? ' unread' : ' read'}${here ? ' on' : ''}`}
      aria-current={here || undefined}
      onClick={(ev) => readOnButton(ev, () => onRead(e))}
    >
      <CardFace
        item={i}
        size="s"
        subtle
        unread={unread}
        where={
          <>
            <ProjectName name={e.projectName} />
            {e.project === current && <OtherCanvas item={i} named />}
          </>
        }
        since={when(e.since)}
        title={
          <button type="button" className="ttl-link" onClick={() => onGo(e)}>
            {i.title ? plain(i.title) : shownTitle(i)}
          </button>
        }
        text={e.text && <Inline md={e.text} />}
      >
        <div className="replies">
          {quickReplies(i).map((r) => (
            <button key={r.label} type="button" className={r.primary ? 'btn primary' : 'btn'} title={r.title} onClick={() => onReply(e.project, i, r)}>
              {r.label}
            </button>
          ))}
          <GoTo e={e} onGo={onGo} />
        </div>
      </CardFace>
    </li>
  );
}

const ProjectName = ({ name }: { name: string }) => (
  <>
    <GitBranch size={12} strokeWidth={2} aria-hidden />
    <span className="project">{name}</span>
  </>
);

/** "Go to card", or "Go to Seismic" on Seismic's answer: on every entry, last and never primary. */
const GoTo = ({ e, onGo }: { e: InboxEntry; onGo: (e: InboxEntry) => void }) => (
  <button type="button" className="btn" onClick={() => onGo(e)}>
    {e.card ? t.inbox.goToCard : t.inbox.goToObeya}
  </button>
);

type Filter = 'all' | 'unread';

/** The entries as a list, the same on the desktop's sheet and the phone. */
export function InboxList({ entries: all, current, open, onGo, onReply, onProposalCard, onProposalConfig, isRead, onRead, els }: InboxProps) {
  const [filter, setFilter] = useStoredState<Filter>('obeya-inbox-filter', 'unread');
  const [everywhere, setEverywhere] = useStoredState<boolean>('obeya-inbox-all-projects', false);
  const entries = current && !everywhere ? all.filter((e) => e.project === current) : all;
  if (!entries.length && !current) return <p className="empty-inbox">{t.inbox.empty}</p>;
  // the open card's entry stays while the owner is at it, read or not
  const shown = filter === 'all' ? entries : entries.filter((e) => !isRead(e) || (!!e.card && e.card.id === open));
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
            <li key={e.key} className={`inbox-entry proposal-entry${cls}`} onClick={(ev) => readOnButton(ev, () => onRead(e))}>
              <div className="where"><GitBranch size={12} aria-hidden /><span className="project">{e.projectName}</span>{unread && <UnreadDot />}</div>
              <ul className="prefs proposals">
                {e.preference && <ProposalRow p={e.preference} items={e.proposalItems ?? []} rules={e.rules ?? []} repos={e.repos ?? []} project={e.project} onOpen={(i) => onProposalCard(e.project, i)} />}
                {e.setting && <SettingRow p={e.setting} items={e.proposalItems ?? []} repo={e.repos?.find((r) => r.id === e.setting!.repo)} project={e.project} onOpen={(i) => onProposalCard(e.project, i)} onConfig={onProposalConfig ? () => onProposalConfig(e.project, e.setting!.repo, e.setting!.field) : undefined} />}
              </ul>
            </li>
          );
          if (e.card) return <CardEntry key={e.key} e={e as InboxEntry & { card: Item }} unread={unread} here={e.card.id === open} current={current} onGo={onGo} onReply={onReply} onRead={onRead} els={e.project === current ? els : undefined} />;
          return (
            // Seismic's answers, which are no card, in the same lines as a card's entry
            <li key={e.key} className={`inbox-entry${cls}`} onClick={(ev) => readOnButton(ev, () => onRead(e))}>
              <div className="face face-s obeya-answer">
                <div className="f-top">
                  <span className="f-where">
                    <ProjectName name={e.projectName} /> · {when(e.since)}
                  </span>
                </div>
                <div className="f-ttl">
                  {unread && <UnreadDot />}
                  <span className="f-ttl-text">
                    <button type="button" className="ttl-link" onClick={() => onGo(e)}>
                      {t.koordinator.title}
                    </button>
                  </span>
                </div>
                <div className="f-state">{t.phone.obeyaAnswered}</div>
                {e.text && <div className="f-text">{plain(e.text)}</div>}
                <div className="replies">
                  <GoTo e={e} onGo={onGo} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The width of the inbox view's list, beside which a card opened from it unfolds. */
export const inboxListWidth = () => Math.round(Math.min(480, Math.max(340, innerWidth * 0.36)));

/**
 * The desktop's inbox, a full-page view of the main area: the list at the left, the room beside it
 * where a card opened from it unfolds (`held`: the list stays above the dim, usable, the open card's
 * entry ringed). Its ✕ and Esc (in App, once no card is open) close it.
 */
export function InboxView({ on, held, onClose, ...p }: InboxProps & { on: boolean; held: boolean; onClose: () => void }): ReactNode {
  if (!on) return null;
  return (
    <FullPage id="inbox-full" title={t.inbox.title}>
      <div className={held ? 'inbox-col held' : 'inbox-col'}>
        <h2>{t.inbox.title}</h2>
        <InboxList {...p} />
      </div>
      <div className="inbox-room">
        <button className="a-full" title={t.close} aria-label={t.close} onClick={onClose}>
          <X size={16} />
        </button>
        <p className="hint">{t.inbox.pick}</p>
      </div>
    </FullPage>
  );
}
