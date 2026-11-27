











import { Fragment } from 'react';
import type { InboxEntry } from '../core/inbox';
import type { Item } from '../core/types';
import { renderEntry } from './needsYou/renderers';
import type { QuickReply } from './quickReply';
import { useStoredState } from './stored';
import { t } from './strings';
import { emptyInboxClass, entryListClass, inboxBarClass } from './inboxClasses';
import { CheckLabel } from './components/checkLabel';
import { Switch } from './components/switch';
import { SegmentedControl } from './components/segmented';

export interface InboxProps {
  entries: InboxEntry[];
  
  current?: string;
  
  open?: string;
  onGo: (e: InboxEntry) => void;
  onReply: (project: string, i: Item, r: QuickReply) => void;
  onProposalCard: (project: string, i: Item) => void;
  onProposalConfig?: (project: string, repo: string, field: string) => void;
  
  isRead: (e: InboxEntry) => boolean;
  
  onRead: (e: InboxEntry) => void;
  
  els?: Map<string, HTMLElement>;
}

type Filter = 'all' | 'unread';

/** The entries as a list, the same on the desktop's sheet and the phone. */
export function InboxList({ entries: all, current, open, onGo, onReply, onProposalCard, onProposalConfig, isRead, onRead, els }: InboxProps) {
  const [filter, setFilter] = useStoredState<Filter>('seismic-inbox-filter', 'unread');
  const [everywhere, setEverywhere] = useStoredState<boolean>('seismic-inbox-all-projects', false);
  const entries = current && !everywhere ? all.filter((e) => e.project === current) : all;
  if (!entries.length && !current) return <p className={emptyInboxClass}>{t.inbox.empty}</p>;
  
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
