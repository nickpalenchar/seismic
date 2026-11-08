// The Agents sheet's "Activity" tab: what happened lately on the cards and who did it, newest first,
// under "Today", "Yesterday" and then dates. Each line says it in small text above the card's face
// (compact, as in the queue) and the time at the right; a click opens a live card. Older lines load
// as the list is scrolled to its end. The lines come from the server's Activity log, which the page
// reads again whenever the project changes.

import { GitBranch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry, Item } from '../core/types';
import { api } from './api';
import { OtherCanvas } from './canvases';
import { CardFace, cardClass } from './card';
import { useStoredState } from './stored';
import { clock, t } from './strings';

/** The log of the open project, or with the switch on, of every project. */
export function ActivityTab({ project, changed, open, onGo }: { project: string; changed: unknown; open?: string; onGo: (project: string, i: Item) => void }) {
  const [everywhere, setEverywhere] = useStoredState<boolean>('obeya-activity-all-projects', false);
  const all = everywhere;
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
      <div className="inbox-bar activity-bar">
        <label className="inbox-all-projects">
          <input type="checkbox" role="switch" className="toggle" checked={everywhere} onChange={(ev) => setEverywhere(ev.target.checked)} />
          {t.inbox.allProjects}
        </label>
      </div>
      {loaded && !entries.length ? (
        <p className="hint agents-empty">{t.agents.activity.empty}</p>
      ) : (
        <ul className="activity-list">
          {entries.map((e) => {
            const d = t.archive.day(new Date(e.at));
            const heading = d !== day && (day = d);
            return (
              <li key={e.id} className="activity-row">
                {heading && <h3 className="activity-day">{heading}</h3>}
                <div className="activity-what">
                  <span className="activity-text">{t.agents.activity.line(e)}</span>
                  {all && (
                    <span className="activity-where">
                      <GitBranch size={11} aria-hidden />
                      {e.projectName}
                    </span>
                  )}
                  {e.project === project && <OtherCanvas item={e.card} />}
                  <span className="activity-time">{clock(e.at)}</span>
                </div>
                {e.deleted ? (
                  <div className={`${cardClass(e.card)} act-card gone`}>
                    <CardFace item={e.card} />
                  </div>
                ) : (
                  <button type="button" className={`${cardClass(e.card)} act-card${e.card.id === open ? ' on' : ''}`} aria-current={e.card.id === open || undefined} onClick={() => onGo(e.project, e.card)}>
                    <CardFace item={e.card} />
                  </button>
                )}
              </li>
            );
          })}
          {more && <li ref={end} className="activity-end" aria-hidden />}
        </ul>
      )}
    </>
  );
}
