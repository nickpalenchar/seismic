







import { cn } from 'cn';
import { ChevronRight, ListChecks } from 'lucide-react';
import { Fragment, useState } from 'react';
import { counted, type InboxEntry } from '../core/inbox';
import type { Item } from '../core/types';
import { Docked, sheetTitleClass } from './docked';
import type { InboxProps } from './inbox';
import { renderEntry } from './needsYou/renderers';
import { useStoredState } from './stored';
import { t } from './strings';
import { CheckLabel } from './components/check-label';
import { Switch } from './components/switch';
import { Badge } from './components/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './components/empty';
import { emptyInboxClass, entryListClass, inboxBarClass } from './inboxClasses';

type CardOnly = InboxEntry & { card: Item };

export function NeedsYouSheet({ on, entries, current, open, onGo, onReply, isRead, onRead }: Omit<InboxProps, 'onProposalCard' | 'onProposalConfig' | 'els'> & { on: boolean; current: string }) {
  const [hideOthers, setHideOthers] = useStoredState<boolean>('seismic-needs-you-hide-others', false);
  
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const cards = entries.filter((e): e is CardOnly => !!e.card);
  const here = cards.filter((e) => e.project === current);
  const others = [...new Set(cards.filter((e) => e.project !== current).map((e) => e.project))].map((project) => ({ project, entries: cards.filter((e) => e.project === project) }));
  const entry = (e: CardOnly) => (
    <Fragment key={e.key}>{renderEntry(e, { unread: !isRead(e), here: e.project === current && e.card.id === open, current, subtle: false, onGo, onReply, onRead })}</Fragment>
  );
  const showEmpty = !here.length && (!others.length || hideOthers);
  return (
    <Docked id="needs-you" className={cn('pt-5 px-3.5 pb-8', showEmpty && 'flex flex-col')} on={on} label={t.needsYou.title}>
      <h2 className={`${sheetTitleClass} px-2`}>{t.needsYou.title}</h2>
      <div className={cn(inboxBarClass, 'justify-end')}>
        <CheckLabel>
          <Switch checked={hideOthers} onCheckedChange={setHideOthers} />
          {t.needsYou.hideOthers}
        </CheckLabel>
      </div>
      {here.length ? (
        <ul className={entryListClass}>{here.map(entry)}</ul>
      ) : !showEmpty ? (
        <p className={emptyInboxClass}>{t.needsYou.noneHere}</p>
      ) : (
        <Empty className="needs-you-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecks aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t.needsYou.emptyTitle}</EmptyTitle>
            <EmptyDescription>{t.needsYou.emptyText}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {!hideOthers &&
        others.map(({ project, entries: list }) => {
          const open = unfolded.includes(project);
          const n = list.filter(counted).length;
          return (
            <section key={project} className="ny-project mt-3.5">
              <button
                type="button"
                className={cn(
                  'ny-head flex items-center gap-2 w-full p-2 [border:0] rounded-sm bg-transparent text-base font-semibold text-foreground cursor-pointer text-left hover:bg-muted [&>svg]:flex-none [&>svg]:text-muted-foreground [&>svg]:[transition:transform_.15s]',
                  open && 'open [&>svg]:[transform:rotate(90deg)]',
                )}
                aria-expanded={open}
                title={t.needsYou.project(list[0]!.projectName, n)}
                onClick={() => setUnfolded(open ? unfolded.filter((p) => p !== project) : [...unfolded, project])}
              >
                <ChevronRight size={14} strokeWidth={2} aria-hidden />
                <span className="ny-name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{list[0]!.projectName}</span>
                {n > 0 && <Badge variant="count" tone="waiting">{n}</Badge>}
              </button>
              {open && <ul className={cn(entryListClass, 'mt-1.5')}>{list.map(entry)}</ul>}
            </section>
          );
        })}
    </Docked>
  );
}
