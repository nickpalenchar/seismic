// How each kind of wait shows as an entry in the inbox, the "Needs you" sheet and the phone's list:
// one renderer per kind (`NeedsYouKind`), so a new kind does not compile until it has one. The card
// kinds share the card's entry, its face at size S with what it waits for under its state and its
// one-click replies (src/ui/quickReply.ts); a proposed rule and a setting proposal show their rows
// of the Koordinator's sheet; the Koordinator's answer shows in the same lines as a card's entry.

import type { MouseEvent, ReactNode } from 'react';
import { GitBranch } from 'lucide-react';
import type { InboxEntry } from '../../core/inbox';
import type { Item } from '../../core/types';
import type { NeedsYouKind } from '../../core/waits';
import { OtherCanvas } from '../canvases';
import { CardFace, shownTitle, UnreadDot } from '../card';
import { Button } from '../components/button';
import { ProposalRow, SettingRow } from '../koordinator';
import { Inline, plain } from '../markdown';
import { type QuickReply, quickReplies } from '../quickReply';
import { clock, shortDay, t } from '../strings';

/** When it began: the time today, else the day. */
export const when = (iso: string | number) => (new Date(iso).toDateString() === new Date().toDateString() ? clock(iso) : shortDay(iso));

/** What an entry is rendered with, besides the entry itself. */
export interface EntryProps {
  unread: boolean;
  /** Its card is the one open now, or flying open: the entry is ringed. */
  here: boolean;
  /** The project shown now. */
  current?: string;
  /** A card's face subtle (the inbox) or regular ("Needs you"). */
  subtle: boolean;
  onGo: (e: InboxEntry) => void;
  onReply: (project: string, i: Item, r: QuickReply) => void;
  onRead: (e: InboxEntry) => void;
  onProposalCard?: (project: string, i: Item) => void;
  onProposalConfig?: (project: string, repo: string, field: string) => void;
  /** Where a card opened from its entry unfolds from and folds back to. */
  els?: Map<string, HTMLElement>;
}

export type Renderer = (e: InboxEntry, p: EntryProps) => ReactNode;

/**
 * Only a click on a button reads the entry, not one on the text around it; read as the click
 * bubbles up, after the button's own action: read in the capture phase, the entry leaves the
 * "Unread" list before the click reaches its button, which then neither opens nor answers.
 */
const readOnButton = (ev: MouseEvent, read: () => void) => {
  const hit = (ev.target as Element).closest('button, a');
  if (hit?.tagName === 'BUTTON') read();
};

const ProjectName = ({ name }: { name: string }) => (
  <>
    <GitBranch size={12} strokeWidth={2} aria-hidden />
    <span className="project">{name}</span>
  </>
);

/** "Go to card", or "Go to Seismic" on Seismic's answer: on every entry, last and never primary. */
const GoTo = ({ e, onGo }: { e: InboxEntry; onGo: (e: InboxEntry) => void }) => (
  <Button type="button" onClick={() => onGo(e)}>
    {e.card ? t.inbox.goToCard : t.inbox.goToObeya}
  </Button>
);

/** A card's entry: its face at size S with what it waits for, its one-click replies and "Go to card"; the open card's is ringed. */
function CardEntry({ e, unread, here, current, onGo, onReply, onRead, els, subtle }: EntryProps & { e: InboxEntry & { card: Item } }) {
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
        subtle={subtle}
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
            <Button key={r.label} type="button" size="small" variant={r.primary ? 'primary' : 'default'} title={r.title} onClick={() => onReply(e.project, i, r)}>
              {r.label}
            </Button>
          ))}
          <GoTo e={e} onGo={onGo} />
        </div>
      </CardFace>
    </li>
  );
}

/** A proposed rule's or setting's entry: its row of the Koordinator's sheet under its project. */
function ProposalEntry({ e, unread, onRead, children }: { e: InboxEntry; unread: boolean; onRead: (e: InboxEntry) => void; children: ReactNode }) {
  return (
    <li className={`inbox-entry proposal-entry${unread ? ' unread' : ' read'}`} onClick={(ev) => readOnButton(ev, () => onRead(e))}>
      <div className="where">
        <GitBranch size={12} aria-hidden />
        <span className="project">{e.projectName}</span>
        {unread && <UnreadDot />}
      </div>
      <ul className="prefs proposals">{children}</ul>
    </li>
  );
}

const card: Renderer = (e, p) => (e.card ? <CardEntry e={e as InboxEntry & { card: Item }} {...p} /> : null);

const rule: Renderer = (e, p) =>
  e.preference ? (
    <ProposalEntry e={e} unread={p.unread} onRead={p.onRead}>
      <ProposalRow p={e.preference} items={e.proposalItems ?? []} rules={e.rules ?? []} repos={e.repos ?? []} project={e.project} onOpen={(i) => p.onProposalCard?.(e.project, i)} />
    </ProposalEntry>
  ) : null;

const setting: Renderer = (e, p) => {
  const s = e.setting;
  if (!s) return null;
  const config = p.onProposalConfig;
  return (
    <ProposalEntry e={e} unread={p.unread} onRead={p.onRead}>
      <SettingRow p={s} items={e.proposalItems ?? []} repo={e.repos?.find((r) => r.id === s.repo)} project={e.project} onOpen={(i) => p.onProposalCard?.(e.project, i)} onConfig={config ? () => config(e.project, s.repo, s.field) : undefined} />
    </ProposalEntry>
  );
};

/** Seismic's answer, which is no card, in the same lines as a card's entry. */
const answer: Renderer = (e, { unread, onGo, onRead }) => (
  <li className={`inbox-entry${unread ? ' unread' : ' read'}`} onClick={(ev) => readOnButton(ev, () => onRead(e))}>
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

/** Each kind's renderer: the card kinds share the card's entry. */
export const renderers: Record<NeedsYouKind, Renderer> = {
  question: card,
  stuck: card,
  demo: card,
  review: card,
  answered: card,
  landing: card,
  pr: card,
  proposal: card,
  merge: card,
  superseded: card,
  idea: card,
  rule,
  setting,
  answer,
};

/** The entry as its kind renders it. */
export const renderEntry: Renderer = (e, p) => renderers[e.kind](e, p);
