// The inbox: what waits for the owner on every canvas, oldest wait first (src/core/inbox.ts). The
// desktop slides it out as a sheet from the bar's inbox button; the phone lists it as "Needs you".
// Each entry names its canvas small, its card large and what it waits for lighter ("Demo ready" on
// a handover, which is judged on the card); under it, the card's one-click replies
// (src/ui/quickReply.ts), only its default primary, and "Go to card", always there and never the
// primary one.

import { GitBranch } from 'lucide-react';
import type { InboxEntry } from '../core/inbox';
import type { Item } from '../core/types';
import { ProposalRow, SettingRow } from './koordinator';
import { Docked } from './docked';
import { Inline, plain } from './markdown';
import { asksYou } from './parts';
import { type QuickReply, quickReplies } from './quickReply';
import { clock, shortDay, stateLabel, t } from './strings';

/** When it began: the time today, else the day. */
export const when = (iso: string | number) => (new Date(iso).toDateString() === new Date().toDateString() ? clock(iso) : shortDay(iso));

export interface InboxProps {
  entries: InboxEntry[];
  /** The card open now: its entry is marked. */
  open?: string;
  onGo: (e: InboxEntry) => void;
  onReply: (canvas: string, i: Item, r: QuickReply) => void;
  onProposalCard: (canvas: string, i: Item) => void;
  onProposalConfig?: (canvas: string, repo: string, field: string) => void;
}

/** The entries as a list, the same on the desktop's sheet and the phone. */
export function InboxList({ entries, open, onGo, onReply, onProposalCard, onProposalConfig }: InboxProps) {
  if (!entries.length) return <p className="empty-inbox">{t.inbox.empty}</p>;
  return (
    <ul className="inbox-list">
      {entries.map((e) => {
        if (e.preference || e.setting) return (
          <li key={e.key} className="inbox-entry proposal-entry">
            <div className="where"><GitBranch size={12} aria-hidden /><span className="canvas">{e.canvasName}</span></div>
            <ul className="prefs proposals">
              {e.preference && <ProposalRow p={e.preference} items={e.proposalItems ?? []} rules={e.rules ?? []} repos={e.repos ?? []} canvas={e.canvas} onOpen={(i) => onProposalCard(e.canvas, i)} />}
              {e.setting && <SettingRow p={e.setting} items={e.proposalItems ?? []} repo={e.repos?.find((r) => r.id === e.setting!.repo)} canvas={e.canvas} onOpen={(i) => onProposalCard(e.canvas, i)} onConfig={onProposalConfig ? () => onProposalConfig(e.canvas, e.setting!.repo, e.setting!.field) : undefined} />}
            </ul>
          </li>
        );
        const i = e.card;
        const replies = i ? quickReplies(i) : [];
        const here = !!i && i.id === open;
        return (
          <li key={e.key} className={here ? 'inbox-entry on' : 'inbox-entry'} aria-current={here || undefined}>
            <div className="where">
              <GitBranch size={12} strokeWidth={2} aria-hidden />
              <span className="canvas">{e.canvasName}</span>
              <span className="since">{when(e.since)}</span>
            </div>
            <div className="ttl">{i ? <Inline md={i.title} /> : t.koordinator.title}</div>
            <div className={i && asksYou(i) ? 'state asking' : i?.state === 'proposal' && i.retro ? 'state by-obeya' : 'state'}>
              {i ? stateLabel(i) : t.phone.obeyaAnswered}
              {i?.state === 'proposal' && i.retro && <span aria-hidden>✦</span>}
            </div>
            {e.text && <div className="text">{i ? <Inline md={e.text} /> : plain(e.text)}</div>}
            <div className="replies">
              {replies.map((r) => (
                <button key={r.label} type="button" className={r.primary ? 'btn primary' : 'btn'} title={r.title} onClick={() => onReply(e.canvas, i!, r)}>
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
