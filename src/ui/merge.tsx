// Merge selection and the owner's coverage review (design: Merging cards).

import { Fragment, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { type CardAction, type Item, merging, mergeableWith, mergeRank, canMergeFrom, withPart } from '../core/types';
import { Inline, plain } from './markdown';
import { Body, Cards } from './message';
import { api } from './api';
import { CardFace } from './card';
import { MergeMark } from './parts';
import { Shots } from './shots';
import { stateLabel, t } from './strings';

type Act = (a: CardAction, done: { close: true; ack: string } | { close: false }) => Promise<void>;

/** How many cards the picker lists before a search narrows them. */
const SHOWN = 30;

/** Eligible partners, matching the search and ordered by stage, then newest first. */
export function mergeCandidates(p: Item, all: Item[], query: string): Item[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = (i: Item) => `${i.title}\n${i.body}`.toLowerCase();
  return all
    .filter((i) => mergeableWith(p, i) && words.every((w) => text(i).includes(w)))
    .sort((a, b) => pickerRank(a) - pickerRank(b) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

const pickerRank = (i: Item) => i.archivedAt ? 3 : mergeRank(i) <= 1 ? 0 : mergeRank(i) === 2 ? 1 : 2;
const kind = (i: Item) => i.archivedAt ? t.merge.archived : stateLabel(withPart(i, 'idea', { proposal: i.idea?.proposal && { ...i.idea.proposal, merge: undefined } }));

/** "Merge with" on an unworked task: opens the picker of the cards it can be merged with. */
export function MergeButton({ item, all, act }: { item: Item; all: Item[]; act: Act }) {
  const [open, setOpen] = useState(false);
  const cards = useContext(Cards);
  if (!canMergeFrom(item)) return null;
  return (
    <>
      <button className="btn" title={t.merge.buttonHint} onClick={() => setOpen(true)}>
        <MergeMark size={13} /> {t.merge.button}
      </button>
      {open && <MergePicker item={item} all={all} onClose={() => setOpen(false)} onPick={(other) => void act({ action: 'merge', with: other.id }, { close: false }).then(() => { setOpen(false); if (mergeRank(other) < mergeRank(item)) cards.open(other); })} />}
    </>
  );
}

/** Search both active and archived partners by title and task. */
function MergePicker({ item, all, onClose, onPick }: { item: Item; all: Item[]; onClose: () => void; onPick: (other: Item) => void }) {
  const [archived, setArchived] = useState<Item[]>([]);
  useEffect(() => { let live = true; api.archived().then((a) => { if (live) setArchived(a); }, console.error); return () => { live = false; }; }, []);
  const mergedIds = new Set(all.flatMap((i) => i.idea?.proposal?.merge ? [i.idea.proposal.merge.with] : []));
  const candidates = [...all, ...archived.filter((i) => !all.some((x) => x.id === i.id))].filter((i) => !mergedIds.has(i.id));
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const found = useMemo(() => mergeCandidates(item, candidates, query).slice(0, SHOWN), [item, all, archived, query]);
  useEffect(() => field.current?.focus(), []);
  useEffect(() => setAt(0), [query]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAt((n) => Math.max(0, Math.min(found.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && found[at]) {
      e.preventDefault();
      onPick(found[at]!);
    }
  };
  return (
    <div id="merge-pick" onClick={onClose}>
      <div className="box" role="dialog" aria-modal="true" aria-label={t.merge.pickTitle(plain(item.title))} onClick={(e) => e.stopPropagation()} onKeyDown={key}>
        <button className="close" title={t.merge.cancel} onClick={onClose}>
          ✕
        </button>
        <h2>{t.merge.pickTitle(plain(item.title))}</h2>
        <input ref={field} className="merge-search" type="search" placeholder={t.merge.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="hint">{t.merge.hint}</p>
        <ul className="merge-list">
          {found.map((i, n) => (
            <li key={i.id}>
              <button className={n === at ? 'merge-row on' : 'merge-row'} onPointerEnter={() => setAt(n)} onClick={() => onPick(i)}>
                <CardFace item={i} size="xs" tail={i.archivedAt && t.merge.archived} />
              </button>
            </li>
          ))}
        </ul>
        {!found.length && <p className="hint">{query.trim() ? t.merge.noMatch : t.merge.none}</p>}
      </div>
    </div>
  );
}

/** The two original cards, before the owner asks an agent to prepare a merge. */
export function DuplicateMergePreview({ item, partner }: { item: Item; partner: Item }) {
  return <div className="merge-view duplicate-preview">
    <div className="merge-sides">
      {([item, partner] as const).map((card, n) => <Fragment key={card.id}>
        {n === 1 && <div className="merge-sides-glue" aria-hidden><span className="merge-knot"><MergeMark /></span></div>}
        <div className="merge-side">
        <div className="merge-side-kind">{n ? t.duplicate.otherCard : t.duplicate.thisCard}</div>
        <h3><Inline md={card.title} /></h3>
        <Body md={card.body} />
        <Shots ids={card.images} />
        </div>
      </Fragment>)}
    </div>
  </div>;
}

/**
 * An unworked card merged with another card, in its panel: the two cards side by side on top, the merged
 * card under them, centred, with the spinner while an agent writes it; then "Approve merge"
 * and "Separate".
 */
export function MergeView({ item, partner, act }: { item: Item; partner?: Item; act: Act }) {
  const m = item.idea!.proposal!.merge!;
  const [archivedPartner, setArchivedPartner] = useState<Item>();
  useEffect(() => { if (partner) return; let live = true; api.archived().then((a) => { if (live) setArchivedPartner(a.find((i) => i.id === m.with)); }, console.error); return () => { live = false; }; }, [partner, m.with]);
  partner ??= archivedPartner;
  const busy = merging(item);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const sides = useRef<HTMLDivElement>(null);
  const sidesId = useId();
  useEffect(() => {
    if (expanded || !sides.current) return;
    const cards = [...sides.current.querySelectorAll<HTMLElement>('.merge-side')];
    const observer = new ResizeObserver(() => setClipped(cards.some((card) => card.scrollHeight > card.clientHeight + 1)));
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [expanded, item.body, partner?.body]);
  const side = (i: Item | undefined, label: string, left = false) => (
    <div className="merge-side">
      <div className="merge-side-kind">{label}</div>
      {i ? (
        <>
          <h3 className={left && m.outcome && m.titleCovered ? 'merge-covered-title' : undefined}>
            <Inline md={i.title} />
          </h3>
          {left && m.outcome ? (
            <div className="merge-coverage">{m.parts?.map((p, n) => p.covered ? <del key={n}>{p.text}</del> : <span key={n}>{p.text}</span>)}</div>
          ) : <Body md={i.body} />}
          <Shots ids={i.images} />
          {i.idea?.proposal?.questions.map((q, n) => <p className="hint" key={n}>{q.text}{q.options.length ? ` (${q.options.join(' / ')})` : ''}</p>)}
        </>
      ) : (
        <p className="hint">{t.merge.gone}</p>
      )}
    </div>
  );
  return (
    <div className={`merge-view${expanded ? ' expanded' : ''}${clipped ? ' clipped' : ''}`}>
      <div className="merge-sides" ref={sides} id={sidesId}>
        {side(item, kind(item), true)}
        <div className="merge-sides-glue">
          <span className="merge-knot">{busy ? <span className="spinner" /> : <MergeMark />}</span>
        </div>
        {side(partner, partner ? kind(partner) : '')}
      </div>
      {(clipped || expanded) && (
        <button className="btn merge-toggle" aria-expanded={expanded} aria-controls={sidesId} onClick={() => setExpanded(!expanded)}>
          {expanded ? t.merge.showLess : t.merge.showAll}
        </button>
      )}
      <div className="merge-arrow" aria-hidden />
      <div className={busy ? 'merge-result busy' : 'merge-result'}>
        <div className="merge-side-kind">{t.merge.result}</div>
        {busy ? (
          <p className="merge-wait">
            <span className="spinner" /> {t.merge.merging}
          </p>
        ) : m.failed !== undefined ? (
          <p className="p-error">{m.failed}</p>
        ) : (
          <>
            <h3>
              <Inline md={m.title ?? ''} />
            </h3>
            <Body md={m.task ?? ''} />
          </>
        )}
      </div>
      {m.followUp && <>
        <div className="merge-arrow merge-follow-arrow" aria-hidden />
        <div className="merge-result merge-follow-up">
          <div className="merge-side-kind">{t.merge.followUp}</div>
          <h3><Inline md={m.followUp.title} /></h3>
          <Body md={m.followUp.task} />
          <Shots ids={m.followUp.images} />
          {m.followUp.questions.map((n) => <p className="hint" key={n}>{item.idea?.proposal?.questions[n]?.text}</p>)}
        </div>
      </>}
      {m.outcome ? <p className={`merge-callout ${m.outcome}`}>{m.outcome === 'covered' ? t.merge.covered : t.merge.extra}</p> : m.task !== undefined && partner && <p className="hint merge-intro">{t.merge.intro(plain(partner.title))}</p>}
      <div className="actions merge-actions">
        {m.task !== undefined && partner && (
          <button className="btn primary" onClick={() => act({ action: 'approveMerge' }, { close: true, ack: t.merge.approved })}>
            <MergeMark size={13} /> {t.merge.approve}
          </button>
        )}
        {m.failed !== undefined && partner && (
          <button className="btn primary" onClick={() => act({ action: 'merge', with: partner.id }, { close: false })}>
            {t.merge.retry}
          </button>
        )}
        <button className="btn" title={t.merge.separateHint} onClick={() => act({ action: 'separate' }, { close: false })}>
          {t.merge.separate}
        </button>
      </div>
    </div>
  );
}
