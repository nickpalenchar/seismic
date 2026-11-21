// Presentational pieces of the project. State and camera live in App.tsx.

import { headClass } from './cardClasses';
import { connectionDotClass, depHeadClass, depLayerClass, depLineClass, dotSide, type DepKind } from './depsClasses';
import { type Side, SIDES } from './deps';
import { Archive, ChevronDown, ChevronLeft, ChevronRight, Columns3, GitMerge, MessageSquare, Pause, Play, Square } from 'lucide-react';
import { Docked, sheetTitleClass } from './docked';
import { memo, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { type Bounds, dependencyOrder, shapeOf } from '../core/layout';
import { clip } from '../core/text';
import { agentFailed, type AppUpdate, type ProjectInfo, type ClonePool, finished, finishedArchivable, type Item, merging, needsYou, pausable, type PendingRestart, halted, type PoolHost, type PlanHistory, type SourceUpdate, stoppedArchivable, snoozeOf, isPausing, offCanvas, reviewLimited, type CardAction } from '../core/types';
import { CardMore } from './canvases';
import { PlanTalk } from './koordinator';
import { api } from './api';
import { dequeueCard } from './clients/seismic';
import type { Cam, Sides } from './camera';
import type { Shape } from './groups';
import { Doc, Inline, plain } from './markdown';
import { Body } from './message';
import { Naming } from './cardLink';
import { Waiting } from './queue';
import { asksYou, CardFace, cardFlags, cardLook, depTagClass, ttlClass, hasLabels, HourglassMark, LabelMarks, LabelPicks, mergeStatus, shownState, stateVars } from './card';
import { scrollBehavior } from './motion';
import { clock, failText, shortDay, stateLabel, t } from './strings';
import { modelName, StartAgent } from './start-agent';
import { edgeChipPositions } from './edgeChips';
import { cardPath, switchTo } from './address';
import { cn } from 'cn';
import { Pill as BarPill } from './components/pill';
import { Button } from './components/button';
import { Badge } from './components/badge';
import { DrawLine } from './components/draw-line';
import { Popover, PopoverContent, PopoverTrigger, useHoverOpen } from './components/popover';
import { MenuItem } from './components/menu';
import { Tooltip } from './components/tooltip';
import { atWorkOn, BlockedClones, hostDots, DotsFace, WorkstationRows } from './workstations';

/** The button for the conversation with Seismic (the project's top bar, the phone view's): a speech bubble. */
export function TalkIcon() {
  return <MessageSquare size={17} strokeWidth={2} aria-hidden />;
}

// ------------------------------------------------------------------ cards

interface CardProps {
  item: Item;
  /** An unworked card merged with another card: that card, shown glued to it. */
  partner?: Item;
  /** On a project with several repositories, cards name theirs. */
  showRepo: boolean;
  b: Bounds;
  lifted: boolean;
  dragging: boolean;
  pop: boolean;
  /** A prototype of this idea is on the project, which keeps the idea from the archive. */
  prototyped: boolean;
  els: Map<string, HTMLElement>;
  /** Starts a planned card, or one queued behind others despite the likely conflict. */
  onStart: (item: Item) => void;
  /** Takes a finished card or a parked or dropped idea off the project into the archive. */
  onArchive: (item: Item) => void;
  /** While the pointer is on a card with waits: this one is it, comes before it, or waits for it. */
  dep?: 'self' | 'before' | 'after';
  /** The pointer came onto the card (its id) or left it (null). */
  onHover: (id: string | null) => void;
  /** Enter or Space on the focused card opens it, as a click does. */
  onOpen: (item: Item) => void;
  /** What the server is still doing with the card after the owner's click (pushing it onto main, say). */
  underway?: string;
}

/** The marks on the buttons that pause an agent and let it go on. */
export const PauseMark = () => (
  <Pause className="btn-mark" size={11} strokeWidth={1.75} fill="currentColor" aria-hidden />
);
export const PlayMark = () => (
  <Play className="btn-mark" size={11} strokeWidth={1.75} fill="currentColor" aria-hidden />
);

/**
 * The same callout on every card's conversation whose model has no usage left: its worker paused or
 * waiting for the reset, or its code review stopped. It names the model and offers the ways out:
 * try again, hand the work to another agent ("Select new agent") and, for a review, skip it.
 */
export function LimitNotice({ item, codexAllowed = !item.review?.contribution }: { item: Item; codexAllowed?: boolean }) {
  const limitedUntil = item.agent?.limitedUntil;
  const hold = item.hold?.reason === 'limit' ? item.hold : undefined;
  const review = reviewLimited(item);
  const [error, setError] = useState('');
  if (!hold && !limitedUntil && !review) return null;
  const u = t.usageOut;
  const run = (a: CardAction) => { setError(''); return api.act(item.id, a).catch((e) => setError(failText(e))); };
  const setting = item.agent?.workerSetting;
  const identity = item.agent?.identity;
  const worker = hold?.model ? { harness: setting?.harness ?? 'claude', model: hold.model } : identity?.model ? identity : setting ?? identity;
  const model = modelName(review ? item.review?.codeReview?.agent : worker) ?? u.unknownModel;
  // a light blue of its own, the colour of a card paused at the limit (`.card.limit-paused`); wrapping on a narrow screen
  return <div role="status" className="limit-notice flex items-start gap-3 py-3 px-4 my-3 mx-0 text-info-strong bg-info-subtle border border-info/30 rounded-xs text-base/[1.4]">
    <HourglassMark />
    <div className="flex-1 min-w-0">
      <div className="limit-title font-semibold">{review ? u.reviewTitle(model) : u.title(model)}</div>
      <div className="limit-body mt-1 text-sm">{review ? u.reviewBody : u.body}</div>
      {!review && <div className="limit-reset mt-1 text-sm">{hold ? t.limitPaused : t.limitedUntil(clock(limitedUntil!))}{hold && limitedUntil && ` · ${t.limitedUntil(clock(limitedUntil))}`}</div>}
      <div className="limit-actions mt-2.5 flex flex-wrap items-start gap-2">
        <Button onClick={() => void run(review ? { action: 'codeReview' } : { action: 'resume' })}><PlayMark /> {u.tryAgain}</Button>
        <StartAgent label={u.newAgent} role={review ? 'review' : 'worker'} selectionOnly codexAllowed={codexAllowed} hint={review ? u.reviewNewAgentHint : u.newAgentHint} onStart={(agent) => { if (agent) return run(review ? { action: 'codeReview', agent } : { action: 'handOff', agent }).then(() => {}); }} />
        {review && <Button variant="review-warning" title={u.skipReviewHint} onClick={() => void run({ action: 'skipCodeReview' })}>{u.skipReview}</Button>}
      </div>
      {error && <p className="p-error mt-2 mb-0">{error}</p>}
    </div>
  </div>;
}

/** Where a card's buttons stand: a chip's lower, none while the card is picked up (`held`). */
type PlayOn = { chip: boolean; held: boolean };

/**
 * A button at a card's foot, shown while the pointer is on the card (where nothing hovers, always):
 * `play` starts it, `archive` takes it off the project (`beside` the play), `turn` pauses or resumes
 * its agent, faint like the pause on the bubble in its conversation.
 */
function playClass(kind: 'play' | 'archive' | 'turn', on: PlayOn, extra?: string) {
  return [
    'play',
    kind !== 'play' && kind,
    extra,
    "absolute right-2.5 size-[26px] rounded-md grid place-items-center cursor-pointer opacity-0 pointer-events-none [transition:opacity_.15s,transform_.15s] [transform:scale(max(1,calc(.9/var(--s))))] origin-[100%_100%]",
    on.chip ? 'bottom-[19px]' : 'bottom-2',
    kind === 'play' && '[border:0] pl-0.5 pr-0 py-0 bg-working text-primary-foreground [box-shadow:var(--shadow)] hover:[filter:brightness(1.1)]',
    kind === 'archive' && '[border:1px_solid_var(--glass-edge)] p-0 bg-surface text-foreground [box-shadow:var(--shadow)] hover:[filter:brightness(1.1)]',
    kind === 'archive' && extra === 'beside' && 'right-[42px]',
    kind === 'turn' && '[border:1px_solid_var(--border)] p-0 bg-transparent text-muted-foreground [box-shadow:none] [&_.btn-mark]:m-0',
    kind === 'turn'
      ? !on.held && 'group-hover/card:opacity-55 group-hover/card:pointer-events-auto hover:opacity-100 hover:pointer-events-auto hover:text-foreground hover:border-muted-foreground focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:text-foreground focus-visible:border-muted-foreground no-hover:opacity-55 no-hover:pointer-events-auto'
      : [!on.held && 'group-hover/card:opacity-100 group-hover/card:pointer-events-auto', 'no-hover:opacity-100 no-hover:pointer-events-auto'].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * On a card on the project, the pause of its agent at work, at a safe point, or the resume of its
 * paused one (or of one about to pause, which then works on): where a card's play and archive
 * buttons stand, faint, while the pointer is on the card.
 */
function CardTurn({ item, on }: { item: Item; on: PlayOn }) {
  const paused = halted(item);
  if (!paused && !pausable(item)) return null;
  return (
    <Tooltip content={isPausing(item) ? t.pause.takeBackHint : paused ? t.pause.resumeHint : t.pause.safeHint}>
      <button
          className={playClass('turn', on, paused ? 'resume' : undefined)} aria-label={paused ? t.pause.resume : t.pause.button}
          // the project would take the press as the start of a drag or a click that opens the card
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void api.act(item.id, paused ? { action: 'resume' } : { action: 'pause', safePoint: true }).catch(() => {});
          }}
      >
        {paused ? <PlayMark /> : <PauseMark />}
      </button>
    </Tooltip>
  );
}

/**
 * On a card on the project that Seismic is checking before its start, the Stop that calls the start
 * off: where its play stood, faint like the pause of an agent at work.
 */
function CardCheckStop({ item, on }: { item: Item; on: PlayOn }) {
  if (item.state !== 'planned' || !item.queue || !('checking' in item.queue)) return null;
  return (
    <Tooltip content={t.queue.checkingStopHint}>
      <button
          className={playClass('turn', on)} aria-label={t.stop}
          // the project would take the press as the start of a drag or a click that opens the card
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void dequeueCard(item.id).catch(() => {});
          }}
      >
        <Square className="btn-mark" size={10} strokeWidth={1.75} fill="currentColor" aria-hidden />
      </button>
    </Tooltip>
  );
}

/** The play mark on the buttons that start a card or a plan's workstreams. */
const PlayIcon = ({ size }: { size: number }) => (
  <Play size={size} strokeWidth={1.75} fill="currentColor" />
);

/** How many of a plan's workstreams its button starts: those planned and in no queue. */
const startableIn = (kids: Item[]) => kids.filter((k) => k.state === 'planned' && !k.queue).length;

/** A plan is worth arranging by its dependencies with two cards or more standing open in it. */
const arrangeable = (kids: Item[]) => kids.filter((k) => shapeOf(k) !== 'chip').length > 1;

/** The columns mark on the button that arranges a plan's workstreams by what builds on what. */
const ColumnsIcon = ({ size }: { size: number }) => (
  <Columns3 size={size} strokeWidth={1.75} />
);

const sameBounds = (a: Bounds, b: Bounds) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Each card of a merged pair: a card's size and padding. */
const HALF = 'relative flex-[0_0_300px] box-border pt-3 px-3.5 pb-3 rounded-xl';

/**
 * An unworked card merged with another card (`partner`), on the project: both cards side by side, glued by
 * a solid purple line with an arrowhead at each end, its knot a spinner while an agent plans the merge, and the merge mark
 * once the merged card waits for the owner. Both cards carry the merge mark before their state.
 */
function MergedPair({ item, partner, showRepo }: { item: Item; partner?: Item; showRepo: boolean }) {
  return (
    <div className="merge-pair flex items-stretch h-full">
      {/* the card itself, pencilled in like a proposal */}
      <div className={`merge-half ${HALF} [border:1.5px_dashed_var(--proposal)] bg-proposal/4`}>
        <CardFace item={item} where={showRepo ? item.repo : undefined} half="first" />
      </div>
      <div className="merge-glue relative flex-1 flex items-center justify-center text-proposal before:content-[''] before:absolute before:left-1 before:right-1 before:top-[calc(50%-1.5px)] before:h-[3px] before:bg-proposal" title={stateLabel(item)}>
        <span className="merge-head left absolute top-[calc(50%-7px)] border-y-[7px] border-y-transparent left-0 border-r-[12px] border-r-proposal" aria-hidden />
        <span className="merge-knot">{merging(item) ? <span className="spinner" /> : <MergeMark />}</span>
        <span className="merge-head right absolute top-[calc(50%-7px)] border-y-[7px] border-y-transparent right-0 border-l-[12px] border-l-proposal" aria-hidden />
      </div>
      {/* the card it merges with: glass, its state a rule across its top */}
      <div
        className={`merge-half partner s-${partner?.state ?? 'planned'} ${HALF} [border:1px_solid_var(--glass-edge)] bg-card [box-shadow:var(--shadow)] backdrop-blur-glass backdrop-saturate-150 moving:backdrop-filter-none before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-1 before:rounded-xs before:bg-(--c)`}
      >
        {partner ? (
          <CardFace item={partner} mergePartner={mergeStatus(item.idea!.proposal!.merge!)} where={showRepo ? partner.repo : undefined} half="partner" pairOf={item} />
        ) : (
          <div className={ttlClass(cardFlags(item), { place: 'canvas', half: 'partner', untitled: true })}>{t.merge.gone}</div>
        )}
      </div>
      {needsYou(item) && <Badge variant="pin" pulse>✦</Badge>}
    </div>
  );
}

/** Two lines joining into one: the mark of merging cards. */
export const MergeMark = ({ size = 16 }: { size?: number }) => (
  <GitMerge className="merge-mark" size={size} strokeWidth={size <= 13 ? 1.75 : 2} />
);

export const CardView = memo(
  function CardView({ item, partner, b, lifted, dragging, pop, prototyped, showRepo, els, onStart, onArchive, dep, onHover, onOpen, underway }: CardProps) {
    const shape = shapeOf(item);
    // a card the Koordinator is checking has nothing to start yet
    const startable = !item.idea?.proposal?.merge && !item.idea?.mergingInto && item.state === 'planned' && (!item.queue || 'behind' in item.queue);
    // as "Archivieren" in the unfolded card: a finished card of the owner's whose agent is done, a
    // stopped task, or a parked or dropped idea without a prototype on the project
    const archivable =
      !item.archivedAt &&
      (finishedArchivable(item) || stoppedArchivable(item) || (!!item.idea?.discussion && item.idea.discussion.status !== 'open' && !prototyped));
    const look = cardLook(item, { underway, place: 'canvas', shape, dep, lifted, dragging, pop });
    const cls = [
      // the focus ring is an outline: the card's frames and glow are its box-shadow
      'item absolute focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
      look.className,
      shape,
      item.idea?.proposal?.merge && 'merged-pair',
      dep && `dep-${dep}`, lifted && 'lifted', dragging && 'dragging', pop && 'pop'].filter(Boolean).join(' ');
    const on: PlayOn = { chip: shape === 'chip', held: lifted || dragging };
    return (
      <div
        className={cls}
        data-id={item.id}
        ref={(el) => void (el ? els.set(item.id, el) : els.delete(item.id))}
        style={{ ...look.style, left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 2 }}
        // reached by Tab like any control; Enter and Space open it (Space is no push-to-talk on a button)
        tabIndex={0}
        role="button"
        aria-label={plain(item.title)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          if (!e.repeat) onOpen(item);
        }}
        onPointerEnter={() => onHover(item.id)}
        onPointerLeave={() => onHover(null)}
      >
        {(dep === 'before' || dep === 'after') && <div className={depTagClass}>{t.deps[dep]}</div>}
        {item.idea?.proposal?.merge ? (
          <MergedPair item={item} partner={partner} showRepo={showRepo} />
        ) : (
          <CardFace item={item} where={showRepo ? item.repo : undefined} underway={underway} chip={shape === 'chip'} place="canvas" />
        )}
        {!underway && <CardTurn item={item} on={on} />}
        {!underway && <CardCheckStop item={item} on={on} />}
        {startable && (
          <Tooltip content={item.queue ? t.queue.force : t.start}>
            <button
                className={playClass('play', on)} aria-label={item.queue ? t.queue.force : t.start}
                // the project would take the press as the start of a drag or a click that opens the card
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(item);
                }}
            >
              <PlayIcon size={12} />
            </button>
          </Tooltip>
        )}
        {archivable && (
          <Tooltip content={t.archive.archive}>
            <button
                className={playClass('archive', on, startable ? 'beside' : undefined)} aria-label={t.archive.archive}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive(item);
                }}
            >
              <Archive size={14} strokeWidth={2.25} />
            </button>
          </Tooltip>
        )}
      </div>
    );
  },
  (a, b) =>
    a.item === b.item && a.partner === b.partner && sameBounds(a.b, b.b) && a.lifted === b.lifted && a.dragging === b.dragging && a.pop === b.pop && a.prototyped === b.prototyped && a.showRepo === b.showRepo && a.onStart === b.onStart && a.onArchive === b.onArchive && a.dep === b.dep && a.onHover === b.onHover && a.onOpen === b.onOpen && a.underway === b.underway,
);

/**
 * A project's agents on its row in the switcher: while one works
 * there, the moving line of a card at work, which turns into a pause for all of them while the
 * pointer is on the row; with none at work but some paused, a play that resumes them, on the same
 * hover. Where nothing hovers (touch), the button shows throughout.
 */
/** The pause or play on a project's row; `item` where the row is a dropdown's, which makes the button an item of it that the arrow keys reach and that leaves the menu open. */
export function ProjectAgents({ project, item }: { project: ProjectInfo; item?: { active: boolean } | null }) {
  const [asked, setAsked] = useState(false);
  const a = project.agents;
  if (!a) return null;
  const pause = a.running > 0;
  const label = pause ? t.projectPause.pause(a.running) : t.projectPause.resume(a.paused);
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAsked(true);
    (pause ? api.pauseAgents(project.id) : api.resumeAgents(project.id)).catch(console.error).finally(() => setAsked(false));
  };
  const turn = (
    // faint like the pause on a card and on the bubble in its conversation, full under the pointer
    <button
      type="button"
      className="grid h-5 w-[26px] cursor-pointer place-items-center rounded-xs border after:absolute after:inset-0 after:content-[''] border-border bg-transparent p-0 text-muted-foreground opacity-0 transition-opacity duration-120 group-focus-within/project:opacity-55 group-hover/project:opacity-55 hover:border-muted-foreground! hover:text-foreground! hover:opacity-100! focus-visible:border-muted-foreground! focus-visible:text-foreground! focus-visible:opacity-100! data-highlighted:border-muted-foreground! data-highlighted:text-foreground! data-highlighted:opacity-100! [@media(hover:none)]:opacity-55"
      aria-label={`${label}: ${project.name}`} disabled={asked} onClick={click}>
      {pause ? <PauseMark /> : <PlayMark />}
    </button>
  );
  return (
    // on its project's row: the moving line while one works there, which turns into the pause while the pointer is on the row
    <span
      className={cn(
        // where a finger taps, the button's reach (its ::after) is the row's whole height and the end of the row the row leaves free, not the small mark
        'absolute top-1/2 right-2.5 flex h-5 w-[26px] -translate-y-1/2 items-center justify-center [@media(hover:none)]:inset-y-0 [@media(hover:none)]:right-0 [@media(hover:none)]:h-auto [@media(hover:none)]:w-11 [@media(hover:none)]:translate-y-0',
      )}
    >
      {pause && <DrawLine className="w-[26px] group-focus-within/project:hidden group-hover/project:hidden [@media(hover:none)]:hidden" />}
      <Tooltip content={label} side="right">
        {item ? (
          <MenuItem asChild disabled={asked || !item.active} onSelect={(e) => e.preventDefault()}>
            {turn}
          </MenuItem>
        ) : (
          turn
        )}
      </Tooltip>
    </span>
  );
}

/** A restart that waits for workers or the owner: for whom and until when (on hover), and a button that has it go ahead now. */
export function RestartPill({ restart, items, project, onOpen }: { restart: PendingRestart; items: Item[]; project: string; onOpen: (i: Item) => void }) {
  if (restart.repos) return <ReposRestartPill restart={restart} items={items} project={project} onOpen={onOpen} />;
  const n = restart.cards.length + restart.elsewhere.reduce((m, c) => m + c.cards.length, 0);
  const until = clock(restart.deadline);
  const owner = restart.owner;
  const stop = restart.reason === 'stop';
  const update = restart.reason === 'update';
  return (
    <Pill
      restart={restart}
      items={items}
      project={project}
      onOpen={onOpen}
      elsewhere={restart.elsewhere}
      go={api.restartNow}
      going={stop ? t.restart.goingStop : update ? t.restart.goingUpdate : t.restart.going}
      say={t.restart.pill(n, owner, restart.reason)}
      // the deadline does not cut the owner off
      until={!owner.length}
      now={stop ? t.restart.nowStop : update ? t.restart.nowUpdate : t.restart.now}
      risk={stop ? t.restart.nowRiskStop : n ? t.restart.nowRisk : t.restart.nowOwner}
      why={
        <>
          <p>{t.restart.reason[restart.reason]}</p>
          {owner.map((h) => (
            <p key={h}>{t.restart.owner[h]}</p>
          ))}
        </>
      }
      after={
        <>
          {(stop || update) && <p className="hint">{stop ? t.restart.keptStop : t.restart.keptUpdate}</p>}
          {n > 0 && <p className="hint">{stop ? t.restart.deadlineStop(until) : owner.length ? t.restart.deadlineOwner(until) : update ? t.restart.deadlineUpdate(until) : t.restart.deadline(until)}</p>}
        </>
      }
    />
  );
}

/** A restart of some repositories' agents alone, for a change to their configuration, that waits for them; Seismic runs on. */
function ReposRestartPill({ restart, items, project, onOpen }: { restart: PendingRestart; items: Item[]; project: string; onOpen: (i: Item) => void }) {
  const r = t.restart.repos;
  return (
    <Pill
      restart={restart}
      items={items}
      project={project}
      onOpen={onOpen}
      go={api.restartReposNow}
      going={r.going}
      say={r.pill(restart.cards.length)}
      until
      now={r.now}
      risk={r.nowRisk}
      why={<p>{restart.leaving ? r.leaving : r.reason((restart.repos ?? []).join(', '), restart.reason === 'repository')}</p>}
      after={
        <>
          {!restart.leaving && <p className="hint">{r.kept}</p>}
          <p className="hint">{r.deadline(clock(restart.deadline))}</p>
        </>
      }
    />
  );
}

/**
 * The pill of either restart: what it waits for (`say`), with `until` until when, and a button
 * (`now`, its risk on hover) that has it go ahead through `go`, saying `going` once it does. On
 * hover why (`why`), the cards it waits for here and on the other projects (`elsewhere`), and
 * what follows (`after`).
 */
function Pill({ restart, items, project, onOpen, elsewhere = [], go, going, say, until, now, risk, why, after }: {
  restart: PendingRestart;
  items: Item[];
  project: string;
  onOpen: (i: Item) => void;
  elsewhere?: PendingRestart['elsewhere'];
  go: () => Promise<{ restarting: boolean }>;
  going: string;
  say: string;
  until: boolean;
  now: string;
  risk: string;
  why: ReactNode;
  after: ReactNode;
}) {
  const [on, setOn] = useState(false);
  const cards = restart.cards.map((id) => {
    const item = items.find((i) => i.id === id);
    return { item, title: plain(item?.title ?? id) };
  });
  const click = () => {
    setOn(true);
    go().then(
      (r) => r.restarting || setOn(false),
      () => setOn(false),
    );
  };
  if (on)
    return (
      <BarPill variant="flat" className={tipPill(true, false)} id="restart">
        <Spin flat /> {going}
      </BarPill>
    );
  return (
    <TipPill
      id="restart"
      flat
      label={
        <>
          <Spin flat />
          <span className="overflow-hidden text-ellipsis">{say}</span>
          {until && <span className="text-xs font-normal text-info opacity-80">{t.restart.until(clock(restart.deadline))}</span>}
        </>
      }
      action={
        <Tooltip content={risk}>
          <button className={goButton(true)} onClick={click}>
            {now}
          </button>
        </Tooltip>
      }
    >
      {why}
      {cards.length + elsewhere.length > 0 && (
        <>
          <p>{t.restart.waits}</p>
          {cards.length > 0 && (
            <ul>
              {cards.map(({ item, title }, i) => (
                <li key={i}>{item ? (
                  <a
                    className="link card-link"
                    href={cardPath(project, item)}
                    onClick={(m) => {
                      if (m.button || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
                      m.preventDefault();
                      onOpen(item);
                    }}
                  >
                    {title}
                  </a>
                ) : title}</li>
              ))}
            </ul>
          )}
          {elsewhere.map((c) => (
            <div key={c.id}>
              <p className="hint">{t.restart.on(c.project)}</p>
              <ul>
                {c.cards.map((x, i) => (
                  <li key={i}>
                    <a className="link card-link" href={cardPath(c.id, x.short ?? x.id)} onClick={(m) => switchTo(m, cardPath(c.id, x.short ?? x.id))}>
                      {plain(x.title)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
      {after}
    </TipPill>
  );
}

/** A pill with a tip, in the top bar or `flat` in the status bar (in the ice blue of a restart there); tighter at the right where a button ends it. */
const tipPill = (flat: boolean, action: boolean) =>
  cn('relative cursor-default', flat ? 'min-w-0 gap-2 pl-2.5 font-semibold text-info' : 'pl-3.5', action ? 'pr-1' : 'pr-3.5');

/** The button that ends a pill with a tip: go ahead now, install, pull. */
const goButton = (flat: boolean) =>
  cn('cursor-pointer rounded-xs bg-muted px-3 py-1 text-xs font-semibold text-foreground hover:bg-foreground hover:text-background', flat && 'rounded-full px-2.5 py-1');

/** The turning arrow of a restart that waits or goes. */
const Spin = ({ flat }: { flat?: boolean }) => <span className={cn('inline-block animate-[spin_2.4s_linear_infinite] font-bold', flat ? 'text-info' : 'text-working')}>↻</span>;

/**
 * A pill with a tip, in the top bar or `flat` in the status bar: its `label` shows the tip (`children`) while the pointer
 * rests on it, and pins it open on a click (Enter, a tap) until a click elsewhere or Esc; `action`
 * is the pill's button beside the label.
 */
function TipPill({ id, flat = false, label, action, children }: { id: string; flat?: boolean; label: ReactNode; action?: ReactNode; children: ReactNode }) {
  const pop = useHoverOpen();
  return (
    <Popover {...pop.root}>
      <BarPill variant={flat ? 'flat' : 'glass'} size={flat ? undefined : 'bar'} className={tipPill(flat, !!action)} id={id}>
        <PopoverTrigger
          className="flex min-w-0 cursor-default items-center gap-2 rounded-full bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
          {...pop.hover}
          {...pop.trigger}
        >
          {label}
        </PopoverTrigger>
        {action}
      </BarPill>
      <PopoverContent
        side="top"
        align="start"
        className="[&_p]:m-0 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:m-0 [&_ul]:mb-1.5 [&_ul]:pl-4"
        {...pop.hover}
        {...pop.content}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A newer version of the app, downloaded by its shell: what changed (on hover), and a button that
 * installs it once the workers paused, as a restart waits for them (then RestartPill shows the wait).
 * A .deb cannot be replaced by the app: the button opens the release to download it.
 */
export function UpdatePill({ update }: { update: AppUpdate }) {
  const [asked, setAsked] = useState(false);
  const install = () => {
    setAsked(true);
    api.installUpdate().catch(() => setAsked(false));
  };
  return (
    <TipPill
      id="update"
      label={<span>{t.update.pill(update.version)}</span>}
      action={
        update.download ? (
          <button className={goButton(false)} onClick={() => window.open(update.download, '_blank')}>
            {t.update.download}
          </button>
        ) : (
          <button className={goButton(false)} onClick={install} disabled={asked}>
            {t.update.install}
          </button>
        )
      }
    >
      <p>
        <b>{t.update.title(update.version, update.date ? shortDay(update.date) : null)}</b>
      </p>
      {update.notes && <Doc md={update.notes} />}
      <p className="hint">{update.download ? t.update.howDownload : t.update.how}</p>
    </TipPill>
  );
}

/**
 * New commits on the upstream of the checkout Seismic runs from (Seismic from source): which (on
 * hover), and a button that pulls them as a fast-forward, after which Seismic restarts with the new
 * code once the workers paused (then RestartPill shows the wait). Where Seismic cannot fast-forward,
 * there is no button, and the hover says what stands in the way.
 */
export function SourcePill({ source }: { source: SourceUpdate }) {
  const [asked, setAsked] = useState(false);
  // a pull that failed comes back with git's message: the button is there again
  useEffect(() => setAsked(false), [source]);
  const pull = () => {
    setAsked(true);
    api.pullSource().catch(() => setAsked(false));
  };
  const more = source.count - source.commits.length;
  const how = !source.blocked
    ? t.source.how(source.checkout)
    : source.blocked.why === 'diverged'
      ? t.source.diverged(source.checkout, source.upstream)
      : t.source.local(source.checkout, source.blocked.files.map((f) => `\`${f}\``).join(', '));
  return (
    <TipPill
      id="source-update"
      label={<span>{t.source.pill(source.count)}</span>}
      action={
        !source.blocked && (
          <button className={goButton(false)} onClick={pull} disabled={asked}>
            {t.source.pull}
          </button>
        )
      }
    >
      <p>
        <b>{t.source.title(source.count, source.upstream)}</b>
      </p>
      <ul>
        {source.commits.map((c, i) => (
          <li key={i}>
            {c.subject} <span className="hint">{shortDay(c.date)}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="hint">{t.source.more(more)}</p>}
      {source.error && <p className="text-waiting-strong">{t.source.failed(source.error)}</p>}
      <p className="hint">
        <Inline md={how} />
      </p>
    </TipPill>
  );
}

/**
 * The Bun the server runs on is too old (on Linux, before 1.3.14): it can deadlock, and then the
 * project stops loading. It stays in the bar for as long as the server runs on it; what to do, on hover.
 */
export function OldBunPill({ version }: { version: string }) {
  return (
    <TipPill
      id="old-bun"
      label={
        <>
          <span className="font-bold text-waiting-strong">⚠</span>
          <span className="overflow-hidden text-ellipsis">{t.oldBun.pill(version)}</span>
        </>
      }
    >
      <p>
        <b>{t.oldBun.title}</b>
      </p>
      <p>{t.oldBun.why(version)}</p>
      <p>
        <Inline md={t.oldBun.how} />
      </p>
    </TipPill>
  );
}

/**
 * Each repository's pool by machine: a dot per clone, or per card in a worktree and per slot still
 * free, each in the colour of its card's state as the card on the project shows it (pulsing slowly
 * while it is at work, in review or landing), a ring while free, an orange ring while free but
 * blocked; and how many new cards could start now. Hovering or clicking it drops down each
 * machine's slots and each of its workstations in the order of the dots, with the card in it as a
 * compact card, which opens the card (`onOpen`; `onElsewhere` one on another project), and why a
 * blocked clone goes to no card and what to do about it. While every clone is taken and a card
 * waits for one, a faint "⋯" beside a card opens what gives its clone to the one waiting longest
 * (`onTake`); during the undo window the row offers "Undo" (`onKeep`).
 */
export function WorkstationsPill({ pools, project, projects, items, underway, onOpen, onElsewhere, onTake, onKeep }: {
  pools: ClonePool[];
  project: ProjectInfo;
  projects: ProjectInfo[];
  items: Item[];
  /** What the server is still doing with a card after the owner's click (landing it, say), by card. */
  underway: Record<string, string>;
  onOpen: (i: Item) => void;
  onElsewhere: (project: string, card: string) => void;
  onTake: (i: Item) => void;
  onKeep: (i: Item) => void;
}) {
  // shown while the pointer rests on it, pinned by a click (a tap) until one elsewhere or Escape
  const pop = useHoverOpen();
  const several = pools.length > 1;
  const name = (repo: string) => project.repos.find((r) => r.id === repo)?.name ?? repo;
  const forWorkstation = items.filter((i) => (i.queue && 'workstation' in i.queue && i.queue.workstation !== 'slots') || i.agent?.waitsForClone).length;
  const forSlot = items.filter((i) => i.queue && 'workstation' in i.queue && i.queue.workstation === 'slots').length;
  // a clone is taken from its card only while none is free and a card of its repository waits for one
  const wanted = (p: ClonePool) =>
    p.hosts.every((h) => !h.uncapped && h.cards.length + blocked(h) >= h.total) && items.some((i) => i.repo === p.repo && ((i.queue && 'workstation' in i.queue) || i.agent?.waitsForClone));
  const blocked = (h: PoolHost) => h.blocked?.length ?? 0;
  // a new card takes a free clone that is not blocked, on a machine whose busy workers leave it a slot
  const room = (h: PoolHost) => Math.max(0, Math.min(h.slots - h.busy.length, h.total - h.cards.length - blocked(h)));
  const free = (p: ClonePool) => p.hosts.reduce((n, h) => n + room(h), 0);
  const total = (p: ClonePool) => p.hosts.reduce((n, h) => n + h.total, 0);
  const blockedIn = (p: ClonePool) => p.hosts.reduce((n, h) => n + blocked(h), 0);
  // a pool that is only this machine's checkout (its working ideas, a folder's say) counts what is at work, as one without a cap
  const uncapped = (p: ClonePool) => p.hosts.some((h) => h.uncapped) || p.hosts.every((h) => h.checkout);
  const full = pools.every((p) => !uncapped(p) && free(p) === 0);
  // the machines a pool names: those with clones, worktrees without a cap, a clone's folder kept, a follow-up's temporary worktree or an idea's agent at work, and every other machine than this one
  const named = (p: ClonePool) => p.hosts.filter((h) => h.total > 0 || h.uncapped || !h.here || h.kept?.length || h.workstations.length || h.exploring?.length);
  const hasDots = pools.some((p) => named(p).some((h) => hostDots(h, items, underway).length > 0));
  const summary = pools.map((p) => uncapped(p) ? t.workstations.uncapped(p.hosts.reduce((n, h) => n + atWorkOn(h), 0)) : t.workstations.free(free(p), total(p), blockedIn(p))).join(', ');
  const opened = (go: () => void) => {
    pop.close({ restoreFocus: false });
    go();
  };
  return (
    <Popover {...pop.root}>
      <BarPill variant="flat" className="relative p-0" id="workstations">
        <PopoverTrigger aria-label={`${t.workstations.label}: ${summary}`} className={statusFace} {...pop.hover} {...pop.trigger}>
        <span className={cn(hasDots && 'hidden lg:inline')}>{t.workstations.label}</span>
        {pools.map((p) => {
          const hosts = named(p);
          return (
            <span key={p.repo} className="flex items-center gap-1.5">
              {several && <span className="hint hidden lg:inline">{name(p.repo)}</span>}
              {hosts.map((h) => (
                <span key={h.name} className="flex items-center gap-1">
                  {hosts.length > 1 && <span className="hint hidden lg:inline">{h.name}</span>}
                  <DotsFace dots={hostDots(h, items, underway)} />
                </span>
              ))}
              <b className={cn('hidden lg:inline', full && 'text-waiting-strong')}>{uncapped(p) ? t.workstations.uncapped(p.hosts.reduce((n, h) => n + atWorkOn(h), 0)) : t.workstations.free(free(p), total(p), blockedIn(p))}</b>
              {blockedIn(p) > 0 && <b className="text-waiting-strong hidden lg:inline">{t.workstations.blockedCount(blockedIn(p))}</b>}
            </span>
          );
        })}
        <ChevronDown size={12} strokeWidth={1.75} className="hint hidden lg:inline" aria-hidden="true" />
        </PopoverTrigger>
      </BarPill>
      <PopoverContent
        side="top"
        align="end"
        aria-label={t.workstations.label}
        className="flex w-[min(440px,calc(100vw-16px))] cursor-default flex-col gap-1.5 [&_p]:m-0"
        {...pop.hover}
        {...pop.content}
      >
        <p className="lg:hidden"><b>{t.workstations.label}</b> · {summary}</p>
        {pools.map((p) => (
          <div key={p.repo} className="flex flex-col gap-1.5">
            {several && (
              <p>
                <b>{name(p.repo)}</b>
              </p>
            )}
            {named(p).map((h) => (
              <div key={h.name} className="flex flex-col gap-1.5">
                <p>
                  {h.checkout
                    ? t.workstations.checkout(h.name, atWorkOn(h))
                    : h.uncapped
                    ? t.workstations.worktreesUncapped(h.name, atWorkOn(h), hostDots(h, items, underway).length > 0)
                    : h.worktrees
                    ? t.workstations.worktreeSlots(h.name, h.busy.length, h.slots, hostDots(h, items, underway).length > 0)
                    : t.workstations.host(h.name, h.busy.length, h.slots, h.cards.length, h.total)}
                </p>
                {hostDots(h, items, underway).length > 0 && (
                  <WorkstationRows
                    host={h}
                    items={items}
                    underway={underway}
                    projects={projects}
                    onOpen={(i) => opened(() => onOpen(i))}
                    onElsewhere={(c, card) => opened(() => onElsewhere(c, card))}
                    onTake={wanted(p) ? onTake : undefined}
                    onKeep={onKeep}
                  />
                )}
                {h.kept?.map((path) => (
                  <p key={path} className="hint">
                    {t.workstations.kept(path)}
                  </p>
                ))}
                <BlockedClones host={h} />
              </div>
            ))}
          </div>
        ))}
        {forWorkstation > 0 && <p>{t.workstations.waiting(forWorkstation)}</p>}
        {forSlot > 0 && <p>{t.workstations.waitingSlot(forSlot)}</p>}
      </PopoverContent>
    </Popover>
  );
}

/** The face of a status bar's pill that opens a list, the pill's whole height. */
export const statusFace = 'flex h-full cursor-pointer flex-row items-center gap-2 rounded-xs bg-transparent px-2 text-inherit';

/**
 * A plan on the project: a quiet frosted container its workstreams stand in, its head along the top.
 * Its blur goes while the canvas is far out or moves (frost.ts), as the cards' does.
 */
const planClass =
  'group/plan absolute rounded-3xl border border-(--container-line) bg-(--container) backdrop-blur-[6px] backdrop-saturate-[1.2] [:is(.z-far,.moving)_&]:backdrop-filter-none';
/** The plan's head: fold, title, labels, progress and its buttons in a row; a click opens the plan. */
const planHeadClass = 'absolute inset-x-0 top-0 flex cursor-pointer items-center gap-2.5 py-4 pr-6 pl-3 has-[.card-more]:pr-2.5';
/** Folds the plan to its head and back; always in sight, so it is found. */
const planFoldClass =
  'text-base grid h-6 w-6 flex-none cursor-pointer place-items-center rounded-xs [border:0] bg-transparent p-0 -mr-1 text-muted-foreground hover:bg-card hover:text-foreground [&_path]:[fill:none] [&_path]:[stroke:currentColor] [&_path]:[stroke-width:1.6] [&_path]:[stroke-linecap:round] [&_path]:[stroke-linejoin:round]';
/** Arranges the workstreams by their dependencies, or starts all planned ones; quiet until the pointer is on one; gone from afar. */
const planHeadButtonClass =
  'flex flex-none cursor-pointer items-center gap-1.5 rounded-xs border border-border bg-card py-1 pr-3 pl-2 text-xs font-medium [transition:background_.15s,color_.15s,border-color_.15s] hover:enabled:border-working hover:enabled:bg-working hover:enabled:text-primary-foreground [.z-far_&]:hidden';

export const PlanView = memo(
  function PlanView({
    item,
    b,
    kids,
    replies,
    els,
    onStartAll,
    onArrange,
    onCollapse,
    onOpen,
  }: {
    item: Item;
    b: Bounds;
    kids: Item[];
    /** Answers of its plan agent that wait unread. */
    replies: number;
    els: Map<string, HTMLElement>;
    onStartAll: (plan: Item, count: number) => void;
    onArrange: (plan: Item) => void;
    onCollapse: (plan: Item, collapsed: boolean) => void;
    onOpen: (i: Item) => void;
  }) {
    const live = kids.filter((k) => finished(k.state)).length;
    const waiting = kids.filter(needsYou).length;
    const startable = startableIn(kids);
    const collapsed = !!item.plan?.collapsed;
    // the project would take the press as the start of a drag or a click that opens the plan
    const own = (e: React.PointerEvent) => e.stopPropagation();
    const labelled = hasLabels(item);
    return (
      <div
        className={`item plan s-${item.state}${collapsed ? ' collapsed' : ''} ${planClass}`}
        data-id={item.id}
        style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 0 }}
      >
        <div className={`head ${planHeadClass} ${collapsed ? (labelled ? 'h-[46px]' : 'h-[54px]') : 'h-[58px]'}`}>
          <Tooltip content={collapsed ? t.plan.expand : t.plan.collapse}>
            <button
                className={planFoldClass} aria-label={collapsed ? t.plan.expand : t.plan.collapse}
                aria-expanded={!collapsed}
                onPointerDown={own}
                onClick={(e) => {
                  e.stopPropagation();
                  onCollapse(item, !collapsed);
                }}
            >
              {collapsed ? <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" /> : <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          </Tooltip>
          {/* the keyboard's way to what a click on the head does: Enter or Space opens the plan */}
          <span
            className="ttl min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xl leading-[1.15] [font-family:var(--font)] font-[650] tracking-[-.018em] rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (!e.repeat) onOpen(item);
            }}
          >
            {plain(item.title)}
          </span>
          <span className={`kind text-2xs uppercase tracking-[.08em] text-muted-foreground${labelled ? ' hidden' : ''}`}>{t.kind.plan}</span>
          {labelled && (
            <span className={`head-labels absolute left-11 right-[22px] ${collapsed ? 'top-[40px]' : 'top-[47px]'} flex items-center gap-1.5 overflow-hidden [&_.prio]:text-2xs [&_.lchip]:text-2xs`}>
              <LabelMarks item={item} />
            </span>
          )}
          <span className="progress ml-auto whitespace-nowrap text-xs text-muted-foreground [.z-far_&]:hidden">{t.progress(live, kids.length)}</span>
          {/* collapsed, its workstreams are not on the project to arrange; its sheet still has the button */}
          {!collapsed && (item.plan?.arranging || arrangeable(kids)) && (
            <button
              className={`head-btn arrange ${planHeadButtonClass} text-muted-foreground disabled:cursor-default disabled:animate-[arranging_1.4s_ease-in-out_infinite]`}
              disabled={item.plan?.arranging}
              title={`${t.plan.arrangeLong}. ${t.plan.arrangeHint}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onArrange(item);
              }}
            >
              <ColumnsIcon size={11} />
              {item.plan?.arranging ? t.plan.arranging : t.plan.arrange}
            </button>
          )}
          {startable > 0 && (
            <button
              className={`head-btn start-all ${planHeadButtonClass} text-working`}
              title={`${t.plan.startAll(startable)}. ${t.plan.startAllHint}`}
              onPointerDown={own}
              onClick={(e) => {
                e.stopPropagation();
                onStartAll(item, startable);
              }}
            >
              <PlayIcon size={10} />
              {t.plan.startAllShort(startable)}
            </button>
          )}
          {/* "Move to canvas", with its workstreams; its clicks stay its own */}
          <span
            className="plan-more flex flex-none opacity-0 [transition:opacity_.15s] group-hover/plan:opacity-100 has-[[aria-expanded=true]]:opacity-100 no-hover:opacity-100"
            onPointerDown={own} onClick={(e) => e.stopPropagation()}>
            <CardMore item={item} floating />
          </span>
        </div>
        {/* a collapsed plan's workstreams, a mark each in its state's colour: a click opens one, unfolding from its mark */}
        {collapsed && (
          <div className={`marks absolute left-[22px] right-[22px] ${labelled ? 'top-[63px]' : 'top-[54px]'} flex h-3.5 flex-wrap gap-1 overflow-hidden`}>
            {kids.filter((k) => !offCanvas(k)).map((k) => (
              <Tooltip key={k.id} content={plain(k.title)}>
                <button
                  ref={(el) => void (el ? els.set(k.id, el) : els.delete(k.id))}
                  className={`${needsYou(k) ? 'mark yours opacity-100' : 'mark opacity-55'} mt-0.5 h-2.5 w-[18px] flex-none cursor-pointer rounded-xs [border:0] p-0 hover:opacity-100`}
                  aria-label={plain(k.title)}
                  style={{ background: stateVars(shownState(k))['--c'] }}
                  onPointerDown={own}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(k);
                  }}
                />
              </Tooltip>
            ))}
          </div>
        )}
        {(replies > 0 || waiting > 0) && (
          // side by side at the plan's corner, counter-scaled so they stay readable zoomed out
          <div className="badges absolute top-[-10px] right-[-8px] flex gap-1.5 [transform:scale(max(1,calc(.9/var(--s))))] origin-[90%_30%]">
            {/* its plan agent's answers: a speech bubble, unlike the count of workstreams that need the owner */}
            {replies > 0 && (
              <Tooltip content={t.plan.replied(replies)}>
                <Badge
                    asChild
                    variant="pin"
                    pulse
                    className="relative top-auto right-auto scale-100 [--pin:var(--proposal)] flex items-center justify-center gap-1 px-1 cursor-pointer"
                  >
                  <button
                    aria-label={t.plan.replied(replies)}
                    onPointerDown={own}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(item);
                    }}
                >
                  <TalkIcon />
                  {replies > 1 && <span>{replies}</span>}
                </button>
                </Badge>
              </Tooltip>
            )}
            {waiting > 0 && <Badge variant="pin" className="relative top-auto right-auto scale-100">{waiting}</Badge>}
          </div>
        )}
      </div>
    );
  },
  (a, b) =>
    a.item === b.item &&
    a.replies === b.replies &&
    a.onStartAll === b.onStartAll &&
    a.onArrange === b.onArrange &&
    a.onCollapse === b.onCollapse &&
    a.onOpen === b.onOpen &&
    sameBounds(a.b, b.b) &&
    a.kids.length === b.kids.length &&
    a.kids.every((k, i) => k === b.kids[i]),
);

/**
 * A curve between the facing sides of two cards: left and right when they stand more beside each
 * other than above each other, else bottom and top. It leaves and enters the cards square to their
 * sides. With a `head`, it stops that far short of `b`, where the base of an arrow head drawn along
 * its last direction goes, so the head ends on `b`'s side however sharply the curve bends.
 */
export function linkPath(a: Bounds, b: Bounds, head = 0): string {
  const [p0, p1, p2, p3] = linkCurve(a, b, head);
  return `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
}

type Pt = { x: number; y: number };

/** The cubic Bézier curve `linkPath` draws: its start, its two control points and its end. */
function linkCurve(a: Bounds, b: Bounds, head: number): [Pt, Pt, Pt, Pt] {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const across = gapX > gapY;
  // The direction of travel along the axis the cards face each other on, and the ends on it.
  const dir = across ? Math.sign(b.x + b.w / 2 - (a.x + a.w / 2)) || 1 : Math.sign(b.y + b.h / 2 - (a.y + a.h / 2)) || 1;
  const [x1, y1] = across ? [dir > 0 ? a.x + a.w : a.x, a.y + a.h / 2] : [a.x + a.w / 2, dir > 0 ? a.y + a.h : a.y];
  const [x2, y2] = across ? [(dir > 0 ? b.x : b.x + b.w) - dir * head, b.y + b.h / 2] : [b.x + b.w / 2, (dir > 0 ? b.y : b.y + b.h) - dir * head];
  // How far the control points reach out from the cards: half the way, but with a head at least its
  // length (less where the curve hardly goes sideways), so that a short link still runs square into
  // the head instead of meeting it from the side.
  const along = across ? x2 - x1 : y2 - y1;
  const aside = across ? y2 - y1 : x2 - x1;
  const reach = dir * Math.max(dir * along / 2, Math.min(Math.abs(aside) / 2, head));
  const [c1, c2] = across ? [{ x: x1 + reach, y: y1 }, { x: x2 - reach, y: y2 }] : [{ x: x1, y: y1 + reach }, { x: x2, y: y2 - reach }];
  return [{ x: x1, y: y1 }, c1, c2, { x: x2, y: y2 }];
}

/**
 * Where on the link from `a` to `b` its button goes: the middle, or the point nearest the middle that
 * keeps `room` clear of every card in `cards`, so that a card the link passes under never covers it.
 */
export function linkSpot(a: Bounds, b: Bounds, head: number, cards: Bounds[], room: number): Pt {
  const [p0, p1, p2, p3] = linkCurve(a, b, head);
  const at = (t: number) => {
    const u = 1 - t;
    const [k0, k1, k2, k3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: k0 * p0.x + k1 * p1.x + k2 * p2.x + k3 * p3.x, y: k0 * p0.y + k1 * p1.y + k2 * p2.y + k3 * p3.y };
  };
  const clear = (p: Pt) => !cards.some((c) => p.x > c.x - room && p.x < c.x + c.w + room && p.y > c.y - room && p.y < c.y + c.h + room);
  for (let step = 0; step <= 20; step++) {
    for (const t of step ? [0.5 - step * 0.02, 0.5 + step * 0.02] : [0.5]) {
      const p = at(t);
      if (clear(p)) return p;
    }
  }
  return at(0.5);
}

/**
 * A dashed line from each proposal and each follow-up not yet started to the card it came from, and
 * from each prototype to its idea, or to the plan that took the idea's place; none where a wait
 * between the two cards (`waits`, settled ones included, as `standsFor` shows them) already draws its arrow there.
 */
export function Links({ placed, waits, standsFor }: { placed: { item: Item; b: Bounds }[]; waits: [string, string][]; standsFor: (id: string) => string }) {
  const byId = new Map(placed.map((p) => [p.item.id, p]));
  const planOf = new Map(placed.flatMap((p) => (p.item.kind === 'plan' && p.item.plan?.origin ? [[p.item.plan.origin, p]] : [])));
  // both ways: the arrow joins the same two cards whichever of them waits
  const joined = new Set(waits.flatMap(([from, to]) => [`${standsFor(from)} ${standsFor(to)}`, `${standsFor(to)} ${standsFor(from)}`]));
  const paths = placed.flatMap(({ item, b }) => {
    const prototypeOf = item.idea?.prototypeOf;
    const src =
      (item.state === 'proposal' || item.state === 'planned' || prototypeOf) && item.from ? (byId.get(item.from) ?? (prototypeOf ? planOf.get(prototypeOf) : undefined)) : undefined;
    if (!src || joined.has(`${src.item.id} ${item.id}`)) return [];
    return [<path key={item.id} d={linkPath(src.b, b)} />];
  });
  return (
    // above plans (z-index 0), below cards (2): a line from a workstream stays visible over its plan
    <svg id="links" width="1" height="1" className="absolute left-0 top-0 z-1 overflow-visible pointer-events-none [&_path]:fill-none [&_path]:stroke-proposal [&_path]:stroke-2 [&_path]:[stroke-dasharray:5_6] [&_path]:opacity-70">
      {paths}
    </svg>
  );
}

/**
 * The width of a wait's line in project pixels at zoom `s`, the same faint or highlighted, so that
 * the pointer on a card only changes its colour; never thinner on screen than a hair when zoomed out.
 */
/** The head at the end of a wait's line, in a box of 9 by 8 that points right. */
const DEP_HEAD = 'M0,0 L9,4 L0,8 z';

/**
 * A wait's arrow outside the project, straight down from the card waited for to the card waiting, drawn
 * as on the project while the pointer is on a card: `lit-first` towards the card it is about, `lit` away from it.
 */
export function DepArrow({ cls, length = 30, className }: { cls: 'lit' | 'lit-first'; length?: number; className?: string }) {
  const w = depWidth(1);
  const head = depHead(1);
  const x = (head * 8) / 9 / 2 + 1;
  const ink = cls === 'lit' ? 'stroke-proposal' : 'stroke-waiting';
  return (
    <svg className={cn('dep-arrow', className)} width={2 * x} height={length} aria-hidden>
      <line className={`${cls} fill-none ${ink}`} x1={x} y1={0} x2={x} y2={length - head + (0.3 * head) / 9} strokeWidth={w} />
      <path className={`${cls} head stroke-none ${cls === 'lit' ? 'fill-proposal' : 'fill-waiting'}`} d={DEP_HEAD} transform={`translate(${x + (head * 8) / 9 / 2} ${length - head}) rotate(90) scale(${head / 9})`} />
    </svg>
  );
}

export const depWidth = (s: number) => Math.max(2, 1.6 / s);
/** The length of the arrow head at the end of a wait's line, in project pixels: six widths of its line. */
export const depHead = (s: number) => 6 * depWidth(s);

/**
 * Every direct wait between cards on the project as a faint line, from the card waited for to the
 * card waiting; while the pointer is on a card, the waits around it (`lit`) in the waiting colour
 * instead (`first`: the waits on the way to it in the colour of what comes first). A workstream of a collapsed plan stands for its plan (`standsFor`). A dependency
 * whose prerequisite is finished (`settled`) stays as a dim green line to the card it unlocked.
 * `children` go on top: what the pointer can reach on a line.
 */
/**
 * The four dots around a card that draw an arrow from it to the card it waits for. `lit`: the sides
 * whose dot shows (the one under the pointer, or all on a card picked up on touch). Its props are
 * values only, so it is drawn again only when one of them changes, not with every card on the canvas.
 */
export const CardHandles = memo(function CardHandles({ id, x, y, w, h, states, colour, target, lit, onConnect }: { id: string; x: number; y: number; w: number; h: number; states: string; colour: string | undefined; target: boolean; lit: Side | 'all' | null; onConnect: (id: string, side: Side, clientX: number, clientY: number) => void }) {
  return (
    <div data-id={id} className={cn('connection-handles absolute z-4', states, target ? 'pointer-events-auto outline-3 outline-solid outline-waiting outline-offset-3 rounded-sm' : 'pointer-events-none')} style={{ left: x, top: y, width: w, height: h, ...(colour ? { '--c': colour } : {}) } as React.CSSProperties}>
      {/* a dot draws its arrow to where the pointer goes: four per card would only lengthen the Tab path */}
      {SIDES.map((side) => (
        <Tooltip key={side} content={t.deps.connect}>
          <button
            tabIndex={-1}
            className={cn(connectionDotClass, dotSide[side], lit === 'all' || lit === side ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')}
            aria-label={t.deps.connect}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onConnect(id, side, e.clientX, e.clientY);
            }}
          />
        </Tooltip>
      ))}
    </div>
  );
});

export function DepLinks({
  placed,
  waits,
  lit,
  first,
  settled = [],
  standsFor,
  routeOf,
  s,
  children,
}: {
  placed: { item: Item; b: Bounds }[];
  waits: [string, string][];
  lit: [string, string][];
  /** Those of `lit` on the way to the hovered card, as `from to`: in the colour of what comes first. */
  first?: Set<string>;
  settled?: { from: string; to: string }[];
  standsFor: (id: string) => string;
  /** A wait's own route where it has one (an arrow the owner drew at chosen edges), else none. */
  routeOf?: (from: string, to: string, a: Bounds, b: Bounds, head: number) => string | undefined;
  s: number;
  children?: ReactNode;
}) {
  const byId = new Map(placed.map((p) => [p.item.id, p.b]));
  // each wait once between the cards that show it, none from a plan to its own workstream
  const shown = (edges: [string, string][]) =>
    new Map(
      edges.flatMap(([from, to]): [string, [string, string]][] => {
        const e: [string, string] = [standsFor(from), standsFor(to)];
        return e[0] !== e[1] && byId.has(e[0]) && byId.has(e[1]) ? [[e.join(' '), e]] : [];
      }),
    );
  const hot = shown(lit);
  const faint = [...shown(waits)].filter(([k]) => !hot.has(k));
  const taken = new Set([...hot.keys(), ...faint.map(([k]) => k)]);
  const done = [...shown(settled.map((d) => [d.from, d.to]))].filter(([k]) => !taken.has(k));
  const path = (cls: DepKind) => ([k, [from, to]]: [string, [string, string]]) => (
    <path key={`${cls} ${k}`} className={depLineClass[cls]} d={routeOf?.(from, to, byId.get(from)!, byId.get(to)!, depHead(s)) ?? linkPath(byId.get(from)!, byId.get(to)!, depHead(s))} strokeWidth={depWidth(s)} markerEnd={`url(#${cls}-arrow)`} />
  );
  return (
    <svg id="deps" className={cn(depLayerClass, 'z-1')} width="1" height="1">
      <defs>
        {/* The line stops at the head's base (refX 0, a hair inside so no seam shows) and the head points
            on to the card; measured in the line's width, as `depHead` is. */}
        {(['lit', 'lit-first', 'faint', 'done-dep'] as const).map((cls) => (
          <marker key={cls} id={`${cls}-arrow`} className={cn(depLineClass[cls], depHeadClass[cls])} viewBox="0 0 9 8" refX="0.3" refY="4" markerUnits="strokeWidth" markerWidth={6} markerHeight={(6 * 8) / 9} orient="auto">
            <path d={DEP_HEAD} />
          </marker>
        ))}
      </defs>
      {done.map(path('done-dep'))}
      {faint.map(path('faint'))}
      {[...hot].map((e) => path(first?.has(e[1].join(' ')) ? 'lit-first' : 'lit')(e))}
      {children}
    </svg>
  );
}

// ------------------------------------------------------------------ plan sheet

/** A card a workstream waits for: a sibling by its label, any other by its title. */
function sibling(id: string, kids: Item[], all: Item[]): string {
  const k = kids.find((x) => x.id === id);
  return k?.plan?.label ?? plain((k ?? all.find((x) => x.id === id))?.title ?? '…');
}

/** What a workstream builds on, each as an inline card. */
function BuildsOn({ ids, kids, all, onOpen }: { ids: string[]; kids: Item[]; all: Item[]; onOpen: (i: Item) => void }) {
  const cards = ids.map((id) => ({ card: all.find((x) => x.id === id), title: sibling(id, kids, all) }));
  return <Naming text={(...names) => t.plan.buildsOn(names)} cards={cards} onOpen={onOpen} />;
}

/**
 * The open plan: its goal and workstreams (as the doc last stood, for an archived one), the idea
 * it came from and the decisions taken in it; or, while `reading`, its plan doc as written, with the
 * workstream `reading.mark` (a label) in view.
 */
export function Sheet({
  planCard,
  kids,
  all,
  on,
  reading,
  onOpen,
  onRead,
  onStartAll,
  onArrange,
  els,
  version,
}: {
  planCard?: Item;
  kids: Item[];
  /** Every card on the project, to name the cards a workstream waits for. */
  all: Item[];
  on: boolean;
  reading: { mark?: string } | null;
  onOpen: (i: Item) => void;
  /** Reads the plan doc (`{}`), or goes back to the workstreams (`null`). */
  onRead: (r: { mark?: string } | null) => void;
  /** Hands all planned workstreams to the Koordinator, which orders them. */
  onStartAll: (planCard: Item, count: number) => void;
  /** Puts the workstreams in columns by what builds on what. */
  onArrange: (planCard: Item) => void;
  /** Where the cards opened from the sheet unfold from (an archived plan's are not on the project). */
  els: Map<string, HTMLElement>;
  /** Changes when the project does, so the decisions are read again. */
  version: unknown;
}) {
  const [loaded, setLoaded] = useState<{ id: string; h: PlanHistory; opening: number } | null>(null);
  const id = planCard?.id;
  // each time the sheet opens: the history loaded before stands until this opening's comes
  const [opening, setOpening] = useState({ n: 0, on });
  if (opening.on !== on) setOpening({ n: on ? opening.n + 1 : opening.n, on });
  useEffect(() => {
    if (!id || !on) return;
    let current = true;
    const n = opening.n;
    api.history(id).then((h) => current && setLoaded({ id, h, opening: n }), console.error);
    return () => void (current = false);
  }, [id, on, version]);
  // never another plan's
  const history = loaded && loaded.id === id ? loaded.h : null;
  // its conversation counts as in view once this opening's is there: answers that waited for it are marked then
  const talkLoaded = !!history && loaded!.opening === opening.n;
  const ref = (key: string) => (el: HTMLElement | null) => void (el ? els.set(key, el) : els.delete(key));
  const [doc, setDoc] = useState<{ id: string; markdown: string } | null>(null);
  const [failed, setFailed] = useState(false);
  // read again whenever the plan changes, which includes an edit of its doc
  useEffect(() => {
    if (!reading || !planCard) return;
    let current = true;
    setFailed(false);
    api.planDoc(planCard.id).then(
      (d) => current && setDoc({ id: planCard.id, markdown: d.markdown }),
      () => current && setFailed(true),
    );
    return () => void (current = false);
  }, [!!reading, planCard]);
  const box = useRef<HTMLElement>(null);
  const markEl = useRef<HTMLElement | null>(null);
  const shown = reading && doc?.id === planCard?.id ? doc : null;
  const startable = startableIn(kids);
  // once Seismic has read what builds on what, the workstreams in the order they stand arranged in
  const inOrder = kids.some((k) => k.plan?.buildsOn) ? dependencyOrder(kids).map((id) => kids.find((k) => k.id === id)!) : kids;
  // the doc opens at its top, or at the workstream it was opened for
  useEffect(() => {
    if (!shown || !box.current) return;
    box.current.scrollTop = 0;
    if (!markEl.current) return;
    // the sheet widens first: the workstream is where it ends up once the text has settled
    const h = setTimeout(() => markEl.current?.scrollIntoView({ block: 'center', behavior: scrollBehavior() }), 480);
    return () => clearTimeout(h);
  }, [shown?.id, reading, !!shown]);
  return (
    <Docked id="sheet" ref={box} on={!!on} className={reading ? 'reading w-(--read-w) pt-0 px-8 pb-10' : undefined}>
      {planCard?.plan?.file && reading && (
        <>
          <div className="read-head sticky top-0 z-1 flex items-center gap-3 my-0 -mx-8 pt-3.5 pr-14 pb-3 pl-8 bg-surface/88 backdrop-blur-[16px] border-b border-b-border reduced:bg-surface">
            <button className="back inline-flex items-center gap-1 [border:0] bg-muted rounded-xs py-1 px-3 cursor-pointer font-semibold text-sm" onClick={() => onRead(null)}>
              <ChevronLeft size={14} aria-hidden />
              {t.plan.back}
            </button>
            <span className="src font-mono text-xs text-muted-foreground m-0 ml-auto overflow-hidden text-ellipsis whitespace-nowrap">{planCard.plan.file}</span>
          </div>
          {shown ? (
            <Doc md={shown.markdown} mark={reading.mark} markRef={(el) => void (markEl.current = el)} />
          ) : (
            <p className="hint">{failed ? t.plan.failed : t.plan.loading}</p>
          )}
        </>
      )}
      {planCard?.plan?.file && !reading && (
        <>
          <div className="p-kind">
            {planCard.archivedAt ? t.archivedPlan : t.planSheet}
            {planCard.archivedAt ? <LabelMarks item={planCard} /> : <LabelPicks item={planCard} />}
          </div>
          <h2 className={sheetTitleClass}>{plain(planCard.title)}</h2>
          {planCard.archivedAt && <p className="hint">{t.archive.planGone(new Date(planCard.archivedAt))}</p>}
          <div className="goal text-sm opacity-90">
            <Inline md={planCard.plan.goal ?? ''} />
          </div>
          <div className="src font-mono text-xs text-muted-foreground mt-2">{planCard.plan.file}</div>
          {!planCard.archivedAt && (
            <Button className="read mt-3.5" onClick={() => onRead({})}>
              {t.plan.read}
            </Button>
          )}
          {!planCard.archivedAt && startable > 0 && (
            <div className="start-all mt-2.5">
              <Button variant="primary" onClick={() => onStartAll(planCard, startable)}>
                {t.plan.startAll(startable)}
              </Button>
              <p className="hint mt-1.5 mx-0 mb-0">{t.plan.startAllHint}</p>
            </div>
          )}
          {!planCard.archivedAt && (planCard.plan.arranging || arrangeable(kids)) && (
            <div className="arrange mt-2.5">
              <Button disabled={planCard.plan.arranging} onClick={() => onArrange(planCard)}>
                <ColumnsIcon size={12} />
                {planCard.plan.arranging ? t.plan.arranging : t.plan.arrangeLong}
              </Button>
              <p className="hint mt-1.5 mx-0 mb-0">{t.plan.arrangeHint}</p>
            </div>
          )}
          {history?.origin && (
            <button className="origin flex flex-col items-start gap-0.5 w-full mt-3.5 py-2 px-3 border border-dashed border-idea rounded-xs bg-transparent text-foreground text-sm text-left cursor-pointer hover:bg-muted" ref={ref(history.origin.id)} onClick={() => onOpen(history.origin!)}>
              <span className="hint text-2xs">{t.fromIdea}</span>
              <span>{plain(history.origin.title.replace(/^Plan-Doc:\s*/, ''))}</span>
            </button>
          )}
          <ol className="list-none p-0 mt-4 mx-0 mb-0">
            {inOrder.map((k) => (
              <li key={k.id} className="py-2 px-2.5 rounded-xs cursor-pointer text-sm hover:bg-muted" ref={ref(k.id)} onClick={() => onOpen(k)}>
                <CardFace
                  item={k}
                  size="xs"
                  // its text from the plan doc stands below in full
                  text={false}
                  tail={
                    k.queue && 'behind' in k.queue
                      ? <Waiting ids={k.queue.behind} items={all} name={(id) => sibling(id, kids, all)} onOpen={onOpen} />
                      : !finished(k.state) && !!k.plan?.buildsOn?.length && <BuildsOn ids={k.plan.buildsOn} kids={kids} all={all} onOpen={onOpen} />
                  }
                />
                {k.body.trim() && (
                  <div className="ws-text mt-1 text-muted-foreground text-sm leading-[1.4] [&_.p-lead]:text-[length:inherit] [&_.p-lead]:m-0 [&_.p-lead]:max-w-none [&_.p-lead+.p-lead]:mt-1 [&_.p-list]:mt-1 [&_.p-list]:text-[length:inherit] [&_.p-list]:max-w-none [&_.p-list_li]:my-px">
                    <Body md={k.body} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <PlanTalk on={on && !reading && talkLoaded} plan={planCard} talk={history?.talk ?? []} items={all} onOpen={onOpen} />
          <h4 className={headClass}>{t.decisions}</h4>
          {history && history.decisions.length === 0 && <p className="hint">{t.noDecisions}</p>}
          {history && history.decisions.length > 0 && (
            <ul className="decisions list-none p-0 m-0">
              {history.decisions.map((d) => (
                <li key={d.id} className="block cursor-default py-2 px-2.5 border [border-color:var(--container-line)] rounded-sm mb-1.5">
                  <div className="q text-muted-foreground text-sm">{d.question}</div>
                  <div className="a my-0.5">{d.answer}</div>
                  <div className="hint text-2xs">
                    {t.decidedBy[d.by]} · {shortDay(d.at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Docked>
  );
}

// ------------------------------------------------------------------ overlays

/** Chips at the edge of the project pointing at off-screen cards that need the owner; `side`: the panels docked at the window's edges. */
export function Edges({ cam, targets, side, onOpen }: { cam: Cam; targets: { item: Item; b: Bounds }[]; side: Sides; onOpen: (i: Item) => void }) {
  const positions = new Map(edgeChipPositions(targets.map(({ item, b }) => ({ id: item.id, b })), cam, side, innerWidth, innerHeight, innerWidth > 760 ? { x: side.left + 14, y: innerHeight - 46 - MAP_H, w: MAP_W, h: MAP_H } : undefined).map((p) => [p.id, p]));
  return (
    <div id="edges" className="pointer-events-none fixed inset-0 z-15">
      {targets.map(({ item }) => {
        const position = positions.get(item.id);
        if (!position) return null;
        const title = plain(item.title);
        return (
          <button key={item.id} className={`edge s-${item.state} pointer-events-auto absolute box-border flex h-[30px] w-[min(300px,calc(100vw-var(--left,0px)-var(--side,0px)-60px))] cursor-pointer items-center gap-1.5 overflow-hidden rounded-none bg-card py-1 pr-3 pl-2 text-sm font-medium text-ellipsis whitespace-nowrap shadow-glass`} style={{ left: position.x, top: position.y, transform: 'translateY(-50%)' }} onClick={() => onOpen(item)}>
            <span className="grid size-5 flex-none place-items-center rounded-full bg-[var(--c)] text-xs text-c-foreground" style={{ transform: `rotate(${position.angle}deg)` }}>
              ➜
            </span>
            {clip(title, 30)}
          </button>
        );
      })}
    </div>
  );
}

const MAP_W = 210;
const MAP_H = 130;
const MAP_PAD = 10;
const mapScale = (all: Bounds) => Math.min((MAP_W - 2 * MAP_PAD) / all.w, (MAP_H - 2 * MAP_PAD) / all.h);

/** The part of the world the whole minimap panel shows, its padding and letterboxing included. */
export function minimapArea(all: Bounds): Bounds {
  const k = mapScale(all);
  return { x: all.x + all.w / 2 - MAP_W / 2 / k, y: all.y + all.h / 2 - MAP_H / 2 / k, w: MAP_W / k, h: MAP_H / k };
}

export function Minimap({
  cam,
  side,
  all,
  placed,
  territories,
  onJump,
  onFollow,
}: {
  cam: Cam;
  /** The panels docked at the window's edges: the project shows between them. */
  side: Sides;
  all: Bounds;
  placed: { item: Item; b: Bounds }[];
  territories: Shape[];
  onJump: (wx: number, wy: number) => void;
  onFollow: (wx: number, wy: number) => void;
}) {
  const W = MAP_W;
  const H = MAP_H;
  const k = mapScale(all);
  const ox = (W - all.w * k) / 2 - all.x * k;
  const oy = (H - all.h * k) / 2 - all.y * k;
  // a press that moves follows the pointer; one that does not jumps where it was let go
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const world = (e: React.PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k];
  };
  return (
    <div
      id="minimap"
      className="fixed bottom-[46px] left-[calc(var(--left,0px)+14px)] z-20 h-[130px] w-[210px] cursor-pointer overflow-hidden rounded-xl border border-glass-edge bg-card shadow-glass backdrop-blur-[16px] [transition:left_.45s_cubic-bezier(.3,.9,.3,1)] [@media(max-width:760px)]:hidden"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        press.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p) return;
        if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 3) return;
        p.moved = true;
        onFollow(...world(e));
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (p && !p.moved) onJump(...world(e));
      }}
      onPointerCancel={() => (press.current = null)}
    >
      <svg className="block size-full" viewBox={`0 0 ${W} ${H}`}>
        <g transform={`translate(${ox} ${oy}) scale(${k})`}>
          {territories.map(({ g, t: x }) => (
            <path key={g.id} className="fill-[hsl(var(--h)_80%_var(--tl)/calc(var(--ta)*3.5))]" d={x.main} fillRule="evenodd" style={{ '--h': g.hue } as React.CSSProperties} />
          ))}
        </g>
        {placed.map(({ item, b }) => (
          <rect
            key={item.id}
            x={ox + b.x * k}
            y={oy + b.y * k}
            width={b.w * k}
            height={b.h * k}
            rx={item.kind === 'plan' ? 1.5 : 0.5}
            style={{ fill: item.kind === 'plan' ? 'var(--container-line)' : stateVars(snoozeOf(item) ? 'muted' : agentFailed(item) ? 'destructive' : asksYou(item) ? 'asking' : item.state)['--c'] }}
            opacity={item.kind === 'plan' || needsYou(item) ? 1 : 0.55}
          />
        ))}
        <rect
          x={ox + ((side.left - cam.x) / cam.s) * k}
          y={oy + (-cam.y / cam.s) * k}
          width={((innerWidth - side.left - side.right) / cam.s) * k}
          height={(innerHeight / cam.s) * k}
          fill="none"
          style={{ stroke: 'var(--foreground)' }}
          strokeWidth={1.2}
          rx={1}
          opacity={0.5}
        />
      </svg>
    </div>
  );
}
