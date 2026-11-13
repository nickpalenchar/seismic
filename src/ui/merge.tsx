// Merge selection and the owner's coverage review (design: Merging cards).

import { actionsClass } from './cardClasses';
import { cn } from 'cn';
import { Fragment, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Collapsible, CollapsibleTrigger } from './components/collapsible';
import { Callout, CalloutDescription } from './components/callout';
import { TriangleAlert } from 'lucide-react';
import { type CardAction, type Item, merging, mergeableWith, mergeRank, canMergeFrom, withPart } from '../core/types';
import { Inline, plain } from './markdown';
import { Body, Cards } from './message';
import { api } from './api';
import { CardFace } from './card';
import { MergeMark } from './parts';
import { Shots } from './shots';
import { stateLabel, t } from './strings';
import { Button, CloseButton } from './components/button';
import { Command, CommandInput, CommandItem, CommandList } from './components/command';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';

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
      <Button title={t.merge.buttonHint} onClick={() => setOpen(true)}>
        <MergeMark size={13} /> {t.merge.button}
      </Button>
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
  const field = useRef<HTMLInputElement>(null);
  const found = useMemo(() => mergeCandidates(item, candidates, query).slice(0, SHOWN), [item, all, archived, query]);
  return (
    <div className="contents" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent id="merge-pick" glass className="box-border flex w-[640px] flex-col px-[26px] pt-[22px] pb-[18px]" layerClassName="items-start pt-[10vh]" onOpenAutoFocus={(e) => { e.preventDefault(); field.current?.focus(); }}>
          <CloseButton label={t.merge.cancel} className="close absolute top-3 right-3.5" onClick={onClose} />
          <DialogTitle asChild><h2 className="m-0 mr-11 mb-3 text-[21px]">{t.merge.pickTitle(plain(item.title))}</h2></DialogTitle>
          <Command shouldFilter={false} label={t.merge.pickTitle(plain(item.title))} className="min-h-0 flex-1">
            <CommandInput ref={field} icon={false} className="text-[15px] px-3 py-[9px]" aria-label={t.merge.search} placeholder={t.merge.search} value={query} onValueChange={setQuery} />
            <p className={pickHint}>{t.merge.hint}</p>
            <CommandList>
              {found.map((i) => (
                <CommandItem key={i.id} value={i.id} className="w-full gap-3 px-2.5 py-[9px] data-[selected=true]:bg-proposal/10 *:flex-1" onSelect={() => onPick(i)}>
                  <CardFace item={i} size="xs" tail={i.archivedAt && t.merge.archived} />
                </CommandItem>
              ))}
            </CommandList>
            {!found.length && <p className={pickHint}>{query.trim() ? t.merge.noMatch : t.merge.none}</p>}
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The picker's hint under the search, and its "nothing found". */
const pickHint = 'hint mx-0 mt-2 mb-1.5';
/**
 * The merge view: the two cards side by side (the one that dissolves dashed, in the proposal purple), cut to a
 * height until shown in full, glued by the knot; under them, centred, the merged card the arrow points at.
 */
const viewClass = 'merge-view flex flex-col items-center gap-0 mt-2.5';
const sidesClass = 'merge-sides flex items-stretch w-full';
const sideClass = (cut: boolean, faded = false) =>
  cn(
    'merge-side relative flex-[1_1_0] min-w-0 box-border py-3.5 px-4 rounded-[3px] bg-card [box-shadow:var(--shadow)] [@media(max-width:700px)]:p-2.5',
    'first:[box-shadow:none] first:border-[1.5px] first:border-dashed first:border-proposal first:bg-[color-mix(in_srgb,var(--proposal)_4%,var(--card))]',
    cut && 'max-h-[clamp(140px,22dvh,280px)] overflow-clip',
    faded && "after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-7 after:pointer-events-none after:bg-[linear-gradient(transparent,var(--card))]",
  );
const kindClass = 'merge-side-kind text-[11.5px] font-semibold tracking-[.04em] uppercase text-muted-foreground';
const titleClass = 'mt-0.5 mx-0 mb-1.5 [font-family:var(--font)] text-[18px] leading-[1.2]';
const sideTitleClass = `${titleClass} [@media(max-width:700px)]:text-[16px]`;
const glueClass =
  "merge-sides-glue relative flex-[0_0_56px] flex items-center justify-center text-proposal before:content-[''] before:absolute before:left-0 before:right-0 before:top-[calc(50%-1.5px)] before:h-[3px] before:bg-proposal before:opacity-55 [@media(max-width:700px)]:basis-6";
const arrowClass =
  "merge-arrow relative w-[3px] h-[26px] text-proposal bg-current opacity-65 after:content-[''] after:absolute after:-bottom-px after:-left-1 after:border-x-[5.5px] after:border-x-transparent after:border-t-[7px] after:border-t-current";
const resultClass = 'merge-result w-[min(720px,100%)] box-border py-4 px-5 rounded-[3px] bg-card [box-shadow:0_0_0_2px_var(--proposal),var(--shadow)] [@media(max-width:700px)]:p-3.5';

/** The two original cards, before the owner asks an agent to prepare a merge. */
export function DuplicateMergePreview({ item, partner }: { item: Item; partner: Item }) {
  return <div className={`${viewClass} duplicate-preview mt-2.5!`}>
    <div className={sidesClass}>
      {([item, partner] as const).map((card, n) => <Fragment key={card.id}>
        {n === 1 && <div className={glueClass} aria-hidden><span className="merge-knot"><MergeMark /></span></div>}
        <div className={cn(sideClass(true), '[box-shadow:none] border border-line first:border-[1.5px] first:border-dashed first:border-proposal')}>
        <div className={kindClass}>{n ? t.duplicate.otherCard : t.duplicate.thisCard}</div>
        <h3 className={sideTitleClass}><Inline md={card.title} /></h3>
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
  const sidesId = useId();
  const [clipped, setClipped] = useState(false);
  const sides = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded || !sides.current) return;
    const cards = [...sides.current.querySelectorAll<HTMLElement>('.merge-side')];
    const observer = new ResizeObserver(() => setClipped(cards.some((card) => card.scrollHeight > card.clientHeight + 1)));
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [expanded, item.body, partner?.body]);
  const side = (i: Item | undefined, label: string, left = false) => (
    <div className={sideClass(!expanded, clipped && !expanded)}>
      <div className={kindClass}>{label}</div>
      {i ? (
        <>
          <h3 className={cn(sideTitleClass, left && m.outcome && m.titleCovered && 'merge-covered-title line-through text-muted-foreground')}>
            <Inline md={i.title} />
          </h3>
          {left && m.outcome ? (
            <div className="merge-coverage whitespace-pre-wrap [overflow-wrap:anywhere] leading-[1.55]">{m.parts?.map((p, n) => p.covered ? <del key={n} className="text-muted-foreground">{p.text}</del> : <span key={n}>{p.text}</span>)}</div>
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
    <Collapsible open={expanded} onOpenChange={setExpanded} className={cn(viewClass, expanded && 'expanded', clipped && 'clipped')}>
      <div className={sidesClass} ref={sides} id={sidesId}>
        {side(item, kind(item), true)}
        <div className={glueClass}>
          <span className="merge-knot">{busy ? <span className="spinner" /> : <MergeMark />}</span>
        </div>
        {side(partner, partner ? kind(partner) : '')}
      </div>
      {(clipped || expanded) && (
        <CollapsibleTrigger asChild aria-controls={sidesId}>
          <Button className="merge-toggle mt-2.5">{expanded ? t.merge.showLess : t.merge.showAll}</Button>
        </CollapsibleTrigger>
      )}
      <div className={arrowClass} aria-hidden />
      <div className={cn(resultClass, busy && 'busy [box-shadow:0_0_0_1.5px_color-mix(in_srgb,var(--proposal)_45%,transparent),var(--shadow)]')}>
        <div className={kindClass}>{t.merge.result}</div>
        {busy ? (
          <p className="merge-wait flex items-center gap-2.5 mt-2.5 mx-0 mb-1 text-proposal">
            <span className="spinner" /> {t.merge.merging}
          </p>
        ) : m.failed !== undefined ? (
          <p className="p-error">{m.failed}</p>
        ) : (
          <>
            <h3 className={titleClass}>
              <Inline md={m.title ?? ''} />
            </h3>
            <Body md={m.task ?? ''} />
          </>
        )}
      </div>
      {m.followUp && <>
        <div className={cn(arrowClass, 'merge-follow-arrow text-[#3b7dd8]')} aria-hidden />
        <div className={cn(resultClass, 'merge-follow-up [box-shadow:0_0_0_1.5px_#3b7dd8,var(--shadow)]')}>
          <div className={kindClass}>{t.merge.followUp}</div>
          <h3 className={titleClass}><Inline md={m.followUp.title} /></h3>
          <Body md={m.followUp.task} />
          <Shots ids={m.followUp.images} />
          {m.followUp.questions.map((n) => <p className="hint" key={n}>{item.idea?.proposal?.questions[n]?.text}</p>)}
        </div>
      </>}
      {m.outcome === 'followUp' ? <Callout kind="warn" className="mt-3 max-w-[720px] box-border">
        <TriangleAlert />
        <CalloutDescription>{t.merge.extra}</CalloutDescription>
      </Callout> : m.outcome === 'covered' ? <p className="merge-callout covered w-[min(720px,100%)] box-border py-3 px-4 rounded-[3px] leading-[1.45] bg-[color-mix(in_srgb,#41a05a_14%,var(--card))] text-ink">{t.merge.covered}</p> : m.task !== undefined && partner && <p className="hint merge-intro text-center max-w-[720px]">{t.merge.intro(plain(partner.title))}</p>}
      {/* on the phone the decisions stay in view at the page's foot, leaving 87px for the microphone below them (the page reserves 157px under its content) */}
      <div className={cn(actionsClass, "merge-actions justify-center w-full [#panel_&]:panel-foot phone:sticky phone:-bottom-[70px] phone:z-5 phone:py-3 phone:px-0 phone:bg-background phone:border-t phone:border-t-line phone:after:content-[''] phone:after:absolute phone:after:top-full phone:after:left-0 phone:after:right-0 phone:after:h-[calc(87px+env(safe-area-inset-bottom))] phone:after:bg-background phone:after:pointer-events-none")}>
        {m.task !== undefined && partner && (
          <Button variant="primary" onClick={() => act({ action: 'approveMerge' }, { close: true, ack: t.merge.approved })}>
            <MergeMark size={13} /> {t.merge.approve}
          </Button>
        )}
        {m.failed !== undefined && partner && (
          <Button variant="primary" onClick={() => act({ action: 'merge', with: partner.id }, { close: false })}>
            {t.merge.retry}
          </Button>
        )}
        <Button title={t.merge.separateHint} onClick={() => act({ action: 'separate' }, { close: false })}>
          {t.merge.separate}
        </Button>
      </div>
    </Collapsible>
  );
}
