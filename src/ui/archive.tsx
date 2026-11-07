// The archive: finished and stopped cards and parked or dropped ideas taken off the canvas and plans whose plan doc is
// gone, the most recently archived first, listed under the bar's button as the queue is. A plan's
// workstreams belong to it and are not listed on their own. A field over the list filters it as
// the owner types.

import { Maximize2, Minimize2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Item, stopped } from '../core/types';
import { plain } from './markdown';
import { useMenuClose } from './queue';
import { becomesLabel, stateLabel, t } from './strings';

interface Props {
  on: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** A card unfolded from the list is open: the list stays under the dim, for the card to fold back into. */
  held: boolean;
  /** The archive as the server sends it, newest first; a plan is followed by its workstreams. */
  archived: Item[];
  /** Finished cards of the owner's still on the canvas. */
  done: number;
  onOpen: (i: Item) => void;
  onArchiveDone: () => void;
  /** Where an archived card unfolds from and folds back to. */
  els: Map<string, HTMLElement>;
  icon: ReactNode;
}

/** The bar's archive button; a click lists the archive under it. A click beside the list or Esc (in App) closes it. */
export function ArchivePill({ on, onToggle, onClose, held, archived, done, onOpen, onArchiveDone, els, icon }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [full, setFull] = useState(false);
  // the full-screen view lives in the body, but a click in it is no click beside the archive
  const inside = { get current() { return { contains: (n: Node) => !!box.current?.contains(n) || !!(n instanceof Element && n.closest('#archive-full')) } as HTMLElement; } };
  useMenuClose(on, inside, () => held || onClose());
  const field = useRef<HTMLInputElement>(null);
  // what was searched last stays, selected, so typing starts a new search
  useEffect(() => void (on && field.current?.select()), [on, full]);
  // closing the archive (Esc, a click beside it) also leaves the full-screen view
  useEffect(() => void (!on && setFull(false)), [on]);
  const words = searchWords(query);
  const entries = { archived, words, query, onOpen, els };
  const search = (
    <div className="a-search">
      <input
        ref={field}
        type="text"
        autoFocus
        value={query}
        placeholder={t.archive.search}
        aria-label={t.archive.search}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <button className="x" title={t.archive.clearSearch} aria-label={t.archive.clearSearch} onClick={() => (setQuery(''), field.current?.focus())}>
          ×
        </button>
      )}
    </div>
  );
  const archiveDone = done > 0 && (
    <button className="btn" onClick={onArchiveDone}>
      {t.archive.archiveDone(done)}
    </button>
  );
  return (
    <div className="menu-pill archive" ref={box}>
      <button className={on ? 'pill kpill on' : 'pill kpill'} title={t.archive.title} aria-expanded={on} onClick={onToggle}>
        {icon}
        <span className="lbl">{t.archive.button}</span>
      </button>
      {on && !full && (
        <div id="amenu" className="bar-menu archive-menu">
          {archived.length > 0 && (
            <div className="a-head">
              {search}
              <button className="a-full" title={t.archive.fullScreen} aria-label={t.archive.fullScreen} onClick={() => setFull(true)}>
                <Maximize2 size={16} />
              </button>
            </div>
          )}
          {archiveDone}
          <ArchiveEntries {...entries} />
        </div>
      )}
      {on &&
        full &&
        createPortal(
          <div id="archive-full" role="dialog" aria-label={t.archive.button}>
            <div className="a-full-head">
              <h2>{t.archive.button}</h2>
              {search}
              <button className="a-full" title={t.archive.leaveFullScreen} aria-label={t.archive.leaveFullScreen} onClick={() => setFull(false)}>
                <Minimize2 size={16} />
              </button>
            </div>
            <div className="a-full-body">
              {archiveDone}
              <ArchiveEntries {...entries} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

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
          <h4>{day}</h4>
          <ol className="timeline">
            {items.map((i) => {
              const label = labelOf(i);
              return (
                <li key={i.id}>
                  <time>{t.archive.time(new Date(i.archivedAt!))}</time>
                  <span className="tick" />
                  <button className="a-card" ref={(el) => void (el ? els.set(i.id, el) : els.delete(i.id))} onClick={() => onOpen(i)}>
                    <span className="a-ttl">{marked(plain(i.title), words)}</span>
                    {label && (
                      <span className="hint">
                        {label}
                        {i.kind === 'plan' && ` · ${t.archive.workstreams(archived.filter((x) => x.parent === i.id).length)}`}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </>
  );
}

/** An archived card's kind or state; a plain finished task, nearly every entry, goes without one, so the others stand out. */
function labelOf(i: Item) {
  return i.idea || i.prototypeEnd || stopped(i) ? stateLabel(i) : i.becomesPlan ? becomesLabel(i) : i.kind === 'task' ? '' : t.kind[i.kind];
}

/** Lower case without accents, so "uber" finds "Über". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The words of a search in the archive, folded. */
export const searchWords = (query: string) => fold(query).split(/\s+/).filter(Boolean);

/**
 * Whether an archived card holds every word of the search, each anywhere in its title, text,
 * summary, last status or label; a plan's in its goal and its workstreams too.
 */
export function matches(i: Item, words: string[], workstreams: Item[] = []) {
  const text = fold(
    [i.title, i.body, i.summary, i.statusLine, labelOf(i), i.plan?.goal, ...workstreams.flatMap((w) => [w.title, w.body])].filter(Boolean).join('\n'),
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
