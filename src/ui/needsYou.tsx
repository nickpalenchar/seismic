// "Needs you": the cards that wait for the owner, docked on the right behind the floating row's bell.
// The shown project's cards come first, as the inbox lists them (the latest changed first, snoozed
// ones at the end); every other project with cards waiting follows as a header with its count, folded until
// clicked open. "Hide other projects" leaves those headers out, remembered per browser. Each card is
// its inbox entry as its kind renders it (src/ui/needsYou/renderers.tsx): its face at size S, its
// one-click replies and "Go to card".
// Seismic's answers and rule or setting proposals are the inbox's alone.

import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
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
import { emptyInboxClass, entryListClass, inboxBarClass } from './inboxClasses';

type CardOnly = InboxEntry & { card: Item };

export function NeedsYouSheet({ on, entries, current, open, onGo, onReply, isRead, onRead }: Omit<InboxProps, 'onProposalCard' | 'onProposalConfig' | 'els'> & { on: boolean; current: string }) {
  const [hideOthers, setHideOthers] = useStoredState<boolean>('obeya-needs-you-hide-others', false);
  // the other projects opened in this sheet, until the page reloads
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const cards = entries.filter((e): e is CardOnly => !!e.card);
  const here = cards.filter((e) => e.project === current);
  const others = [...new Set(cards.filter((e) => e.project !== current).map((e) => e.project))].map((project) => ({ project, entries: cards.filter((e) => e.project === project) }));
  const entry = (e: CardOnly) => (
    <Fragment key={e.key}>{renderEntry(e, { unread: !isRead(e), here: e.project === current && e.card.id === open, current, subtle: false, onGo, onReply, onRead })}</Fragment>
  );
  return (
    <Docked id="needs-you" className="pt-5 px-3.5 pb-[30px]" on={on} label={t.needsYou.title}>
      <h2 className={`${sheetTitleClass} px-2`}>{t.needsYou.title}</h2>
      <div className={cn(inboxBarClass, 'justify-end')}>
        <CheckLabel>
          <Switch checked={hideOthers} onCheckedChange={setHideOthers} />
          {t.needsYou.hideOthers}
        </CheckLabel>
      </div>
      {here.length ? <ul className={entryListClass}>{here.map(entry)}</ul> : <p className={emptyInboxClass}>{others.length ? t.needsYou.noneHere : t.needsYou.empty}</p>}
      {!hideOthers &&
        others.map(({ project, entries: list }) => {
          const open = unfolded.includes(project);
          const n = list.filter(counted).length;
          return (
            <section key={project} className="ny-project mt-3.5">
              <button
                type="button"
                className={cn(
                  'ny-head flex items-center gap-2 w-full p-2 [border:0] rounded-[6px] bg-transparent text-[14px] font-semibold text-foreground cursor-pointer text-left hover:bg-muted [&>svg]:flex-none [&>svg]:text-muted-foreground [&>svg]:[transition:transform_.15s]',
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
