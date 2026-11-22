// The inbox: what waits for the owner on every project, the latest changed first (src/core/inbox.ts). The
// desktop shows it as a page of the left menu (src/ui/nav.tsx), opened from its "Inbox" entry and sliding in
// at the menu's size, docked or dropped down, with the canvas left in view; a card opened from it unfolds
// beside the docked menu. The phone lists it as "Needs you". The desktop's "Needs you" sheet (src/ui/needsYou.tsx) shows its cards' entries alike.
// Each entry shows as its kind's renderer has it (src/ui/needsYou/renderers.tsx): a card's is its face
// at size S (src/ui/card), its project and canvas on its top line and what it waits for under its
// state ("Demo ready" on a handover, which is judged on the card); under it, the card's one-click
// replies (src/ui/quickReply.ts), only its default primary, and "Go to card", always there and never
// the primary one. Only a click on a button (the title included) reads an entry. Unread entries carry
// an orange dot and a bold title; the switch above the list shows all of them or only the unread ones
// (src/ui/inboxRead.ts keeps what was read).

import { Fragment } from 'react';
import type { InboxEntry } from '../core/inbox';
import type { Item } from '../core/types';
import { renderEntry } from './needsYou/renderers';
import type { QuickReply } from './quickReply';
import { useStoredState } from './stored';
import { t } from './strings';
import { emptyInboxClass, entryListClass, inboxBarClass } from './inboxClasses';
import { CheckLabel } from './components/check-label';
import { Switch } from './components/switch';
import { SegmentedControl } from './components/segmented';

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

type Filter = 'all' | 'unread';

/** The entries as a list, the same on the desktop's sheet and the phone. */
export function InboxList({ entries: all, current, open, onGo, onReply, onProposalCard, onProposalConfig, isRead, onRead, els }: InboxProps) {
  const [filter, setFilter] = useStoredState<Filter>('seismic-inbox-filter', 'unread');
  const [everywhere, setEverywhere] = useStoredState<boolean>('seismic-inbox-all-projects', false);
  const entries = current && !everywhere ? all.filter((e) => e.project === current) : all;
  if (!entries.length && !current) return <p className={emptyInboxClass}>{t.inbox.empty}</p>;
  // the open card's entry stays while the owner is at it, read or not
  const shown = filter === 'all' ? entries : entries.filter((e) => !isRead(e) || (!!e.card && e.card.id === open));
  return (
    <>
      <div className={inboxBarClass}>
      <SegmentedControl
        className="inbox-filter"
        label={t.inbox.filter}
        value={filter}
        onValueChange={setFilter}
        options={(['unread', 'all'] as const).map((f) => ({ value: f, label: f === 'all' ? t.inbox.all : t.inbox.unread }))}
      />
        {current && (
          <CheckLabel>
            <Switch checked={everywhere} onCheckedChange={setEverywhere} />
            {t.inbox.allProjects}
          </CheckLabel>
        )}
      </div>
      {!entries.length && <p className={emptyInboxClass}>{t.inbox.empty}</p>}
      {!!entries.length && !shown.length && <p className={emptyInboxClass}>{t.inbox.noneUnread}</p>}
      <ul className={entryListClass}>
        {shown.map((e) => (
          <Fragment key={e.key}>
            {renderEntry(e, { unread: !isRead(e), here: !!e.card && e.card.id === open, current, subtle: true, onGo, onReply, onRead, onProposalCard, onProposalConfig, els: e.project === current ? els : undefined })}
          </Fragment>
        ))}
      </ul>
    </>
  );
}
