// The archive: finished and stopped cards and parked or dropped ideas taken off the project and plans whose plan doc is
// gone, the most recently archived first, as a full-page view of the main area. A plan's
// workstreams belong to it and are not listed on their own. A field over the list filters it as
// the owner types.

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FullPage, fullBodyClass, fullCloseClass, fullHeadClass, fullTitleClass } from './fullPage';
import type { Item } from '../core/types';
import { CardFace, cardKind } from './card';
import { plain } from './markdown';
import { stateLabel, t } from './strings';
import { Button, CloseButton } from './components/button';

interface Props {
  on: boolean;
  onClose: () => void;
  /** A card unfolded from the list is open: the list stays under the dim, for the card to fold back into. */
  held: boolean;
  /** The archive as the server sends it, newest first; a plan is followed by its workstreams. */
  archived: Item[];
  /** Finished cards of the owner's still on the project. */
  done: number;
  onOpen: (i: Item) => void;
  onArchiveDone: () => void;
  /** Where an archived card unfolds from and folds back to. */
  els: Map<string, HTMLElement>;
}

/** The archive as a full-page view of the main area, opened from the logo's menu. Its ✕, a click beside it or Esc (in App) closes it. */
export function ArchiveView({ on, onClose, held, archived, done, onOpen, onArchiveDone, els }: Props) {
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  // what was searched last stays, selected, so typing starts a new search
  useEffect(() => void (on && field.current?.select()), [on]);
  if (!on) return null;
  const words = searchWords(query);
  return (
    <FullPage id="archive-full" title={t.archive.button} onClickBeside={() => held || onClose()}>
      <div className={fullHeadClass}>
        <h2 className={fullTitleClass}>{t.archive.button}</h2>
        <div className="a-search relative mt-0.5 mx-0 mb-2 flex-1 min-w-0 max-w-[640px]">
          <input
            ref={field}
            className="w-full box-border py-2 pr-[30px] pl-[11px] text-[14px] bg-card border border-border rounded-[3px] [outline:none] focus:border-muted-foreground"
            type="text"
            autoFocus
            value={query}
            placeholder={t.archive.search}
            aria-label={t.archive.search}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <CloseButton label={t.archive.clearSearch} size="small" className="x absolute right-1.5 top-1/2 [transform:translateY(-50%)]" onClick={() => (setQuery(''), field.current?.focus())} />
          )}
        </div>
        <CloseButton label={t.close} className={fullCloseClass} onClick={onClose} />
      </div>
      <div className={fullBodyClass}>
        {done > 0 && (
          <Button onClick={onArchiveDone}>
            {t.archive.archiveDone(done)}
          </Button>
        )}
        <ArchiveEntries archived={archived} words={words} query={query} onOpen={onOpen} els={els} />
      </div>
    </FullPage>
  );
}

/** A day's timeline: per card the time, a tick on the line through the day, and the card; the line starts and ends at the first and last tick. */
const timelineRowClass =
  "relative grid grid-cols-[38px_12px_1fr] gap-x-2 [align-items:start] pb-2 before:content-[''] before:absolute before:left-[51px] before:top-0 before:bottom-0 before:w-0.5 before:bg-border first:before:top-[15px] last:before:bottom-auto last:before:h-[15px] only:before:hidden";

/** An archived card as a small card, the words of the search marked in its title. */
const archiveCardClass =
  'a-card flex flex-col min-w-0 py-2 px-3 text-left [font:inherit] text-foreground bg-card border border-border rounded-[3px] [box-shadow:var(--shadow)] cursor-pointer [transition:transform_.15s,box-shadow_.15s] hover:[transform:translateY(-1px)] hover:[box-shadow:var(--lift)] focus-visible:[outline:2px_solid_var(--working)] focus-visible:outline-offset-2 [&_mark]:bg-muted [&_mark]:text-inherit [&_mark]:rounded-[2px] [&_mark]:[box-shadow:0_0_0_1px_var(--muted)]';

/** The archive's entries, one heading per day in the server's order, filtered by the search; the drop-down and the full-screen view share it. */
function ArchiveEntries({ archived, words, query, onOpen, els }: { archived: Item[]; words: string[]; query: string; onOpen: (i: Item) => void; els: Map<string, HTMLElement> }) {
  const shown = archived.filter((i) => !i.parent && (!words.length || matches(i, words, archived.filter((x) => x.parent === i.id))));
  const days: { day: string; items: Item[] }[] = [];
  for (const i of shown) {
    const day = t.archive.day(new Date(i.archivedAt!));
    if (days.at(-1)?.day === day) days.at(-1)!.items.push(i);
    else days.push({ day, items: [i] });
  }
  if (archived.length === 0) return <p className="hint">{t.archive.empty}</p>;
  if (shown.length === 0) return <p className="hint">{t.archive.noMatch(query.trim())}</p>;
  return (
    <>
      {days.map(({ day, items }) => (
        <section key={day}>
          <h4 className="mt-2.5 mx-0 mb-1.5 text-[11px] uppercase tracking-[.08em] text-muted-foreground">{day}</h4>
          <ol className="timeline list-none p-0 m-[0_0_4px]">
            {items.map((i) => (
              <li key={i.id} className={timelineRowClass}>
                <time className="pt-[9px] text-[11.5px] text-muted-foreground tabular-nums text-right">{t.archive.time(new Date(i.archivedAt!))}</time>
                <span className="tick relative w-3 h-3 mt-2.5 rounded-[50%] bg-surface border-2 border-live box-border" />
                <button className={archiveCardClass} ref={(el) => void (el ? els.set(i.id, el) : els.delete(i.id))} onClick={() => onOpen(i)}>
                  <CardFace
                    item={i}
                    size="xs"
                    title={i.title ? marked(plain(i.title), words) : undefined}
                    tail={i.kind === 'plan' && t.archive.workstreams(archived.filter((x) => x.parent === i.id).length)}
                  />
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

/** Lower case without accents, so "uber" finds "Über". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The words of a search in the archive, folded. */
export const searchWords = (query: string) => fold(query).split(/\s+/).filter(Boolean);

/**
 * Whether an archived card holds every word of the search, each anywhere in its title, text,
 * summary, last status, state or kind; a plan's in its goal and its workstreams too.
 */
export function matches(i: Item, words: string[], workstreams: Item[] = []) {
  const text = fold(
    [i.title, i.body, i.review?.summary, i.agent?.statusLine, stateLabel(i), cardKind(i), i.plan?.goal, ...workstreams.flatMap((w) => [w.title, w.body])].filter(Boolean).join('\n'),
  );
  return words.every((w) => text.includes(w));
}

/** The title with the words of the search marked where they occur. */
export function marked(title: string, words: string[]): ReactNode {
  if (!words.length) return title;
  // folded char by char, each folded unit knowing the title's char it came from
  let folded = '';
  const from: number[] = [];
  const chars = [...title];
  chars.forEach((c, k) => {
    const f = fold(c);
    folded += f;
    for (let u = 0; u < f.length; u++) from.push(k);
  });
  const hit = chars.map(() => false);
  for (const w of words) for (let at = folded.indexOf(w); at >= 0; at = folded.indexOf(w, at + 1)) for (let u = at; u < at + w.length; u++) hit[from[u]!] = true;
  const parts: ReactNode[] = [];
  for (let k = 0; k < chars.length; ) {
    let end = k;
    while (end < chars.length && hit[end] === hit[k]) end++;
    const run = chars.slice(k, end).join('');
    parts.push(hit[k] ? <mark key={k}>{run}</mark> : run);
    k = end;
  }
  return parts;
}
