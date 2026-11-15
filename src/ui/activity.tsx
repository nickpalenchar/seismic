// The Agents sheet's "Activity" tab: what happened lately on the cards and who did it, newest first,
// under "Today", "Yesterday" and then dates. Each line says it in small text above the card's face
// (compact, as in the queue) and the time at the right; a click opens a live card. Older lines load
// as the list is scrolled to its end. The lines come from the server's Activity log, which the page
// reads again whenever the project changes.

import { cn } from 'cn';
import { GitBranch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry, Item } from '../core/types';
import { api } from './api';
import { OtherCanvas } from './canvases';
import { CardFace, cardLook } from './card';
import { useStoredState } from './stored';
import { clock, t } from './strings';
import { CheckLabel } from './components/check-label';
import { Switch } from './components/switch';
import { agentsEmptyClass, inboxBarClass } from './inboxClasses';

/** The log of the open project, or with the switch on, of every project; `allProjects` (the phone, which shows every project) always every project's, without the switch. */
export function ActivityTab({ project, changed, open, onGo, allProjects }: { project: string; changed: unknown; open?: string; onGo: (project: string, i: Item) => void; allProjects?: boolean }) {
  const [everywhere, setEverywhere] = useStoredState<boolean>('seismic-activity-all-projects', false);
  const all = allProjects || everywhere;
  // the lines shown, newest first; `paged` once older pages were added under the first
  const [list, setList] = useState<{ entries: ActivityEntry[]; more: boolean; paged: boolean }>({ entries: [], more: false, paged: false });
  const [loaded, setLoaded] = useState(false);
  const scope = `${project}/${all}`;
  const was = useRef(scope);
  // the first page, read again with every change; the lines loaded under it stay as long as the new page reaches them
  useEffect(() => {
    let current = true;
    if (was.current !== scope) {
      was.current = scope;
      setList({ entries: [], more: false, paged: false });
      setLoaded(false);
    }
    api.activity(project, all).then((p) => {
      if (!current) return;
      setLoaded(true);
      setList((l) => {
        const fresh = new Set(p.entries.map((e) => e.id));
        // more new lines than a page leave a gap to those loaded before: the list starts over from the newest
        if (!l.paged || (p.more && !l.entries.some((e) => fresh.has(e.id)))) return { entries: p.entries, more: p.more, paged: false };
        return { ...l, entries: [...p.entries, ...l.entries.filter((e) => !fresh.has(e.id))] };
      });
    }, console.error);
    return () => void (current = false);
  }, [scope, changed]);
  const { entries, more } = list;
  const last = entries.at(-1);
  const loading = useRef(false);
  const end = useRef<HTMLLIElement>(null);
  const loadOlder = () => {
    if (loading.current || !more || !last) return;
    loading.current = true;
    const at = scope;
    api.activity(project, all, last.id).then((p) => {
      if (was.current !== at) return;
      // a list that started over meanwhile ends elsewhere: this page does not join it
      setList((l) => l.entries.at(-1)?.id !== last.id ? l : ({ entries: [...l.entries, ...p.entries.filter((e) => !l.entries.some((o) => o.id === e.id))], more: p.more, paged: true }));
    }, console.error).finally(() => void (loading.current = false));
  };
  const latest = useRef(loadOlder);
  latest.current = loadOlder;
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && latest.current());
    seen.observe(el);
    return () => seen.disconnect();
  }, [entries.length, more]);
  let day = '';
  return (
    <>
      {!allProjects && (
        <div className={cn(inboxBarClass, 'activity-bar mb-1.5 justify-end')}>
          <CheckLabel>
            <Switch checked={everywhere} onCheckedChange={setEverywhere} />
            {t.inbox.allProjects}
          </CheckLabel>
        </div>
      )}
      {loaded && !entries.length ? (
        <p className={agentsEmptyClass}>{t.agents.activity.empty}</p>
      ) : (
        <ul className="activity-list list-none m-0 pt-0 px-2 pb-2 flex flex-col gap-2.5">
          {entries.map((e) => {
            const d = t.archive.day(new Date(e.at));
            const heading = d !== day && (day = d);
            return (
              // the card's compact face under the line, fitted into the row (`actCard`)
              <li key={e.id} className="activity-row">
                {heading && <h3 className="activity-day mt-2 mx-0.5 mb-0 text-2xs font-semibold tracking-[.04em] uppercase text-muted-foreground">{heading}</h3>}
                <div className="activity-what flex items-center gap-2 mt-0 mx-0.5 mb-1.5 text-xs text-muted-foreground">
                  <span className="activity-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t.agents.activity.line(e)}</span>
                  {all && (
                    <span className="activity-where flex-none inline-flex items-center gap-1 max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap">
                      <GitBranch size={11} aria-hidden />
                      {e.projectName}
                    </span>
                  )}
                  {e.project === project && <OtherCanvas item={e.card} />}
                  <span className="activity-time ml-auto flex-none tabular-nums">{clock(e.at)}</span>
                </div>
                {e.deleted ? (
                  <div {...actCard(e.card, { gone: true })}>
                    <CardFace item={e.card} place="activity" />
                  </div>
                ) : (
                  <button type="button" {...actCard(e.card, { on: e.card.id === open })} aria-current={e.card.id === open || undefined} onClick={() => onGo(e.project, e.card)}>
                    <CardFace item={e.card} place="activity" />
                  </button>
                )}
              </li>
            );
          })}
          {more && <li ref={end} className="activity-end h-px" aria-hidden />}
        </ul>
      )}
    </>
  );
}

/** The card's compact face under an entry's line: its card as the project shows it, fitted into the row (`on`: the card open beside the list; `gone`: deleted since). */
function actCard(card: Item, o: { on?: boolean; gone?: boolean }) {
  const look = cardLook(card, { place: 'activity', ...o });
  return { className: [look.className, 'act-card', o.on && 'on', o.gone && 'gone'].filter(Boolean).join(' '), style: look.style };
}
