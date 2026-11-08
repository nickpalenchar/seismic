// Presentational pieces of the project. State and camera live in App.tsx.

import { Archive, ChevronDown, ChevronRight, Columns3, GitMerge, MessageSquare, Pause, Play, Square } from 'lucide-react';
import { Docked } from './docked';
import { memo, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Bounds, dependencyOrder, shapeOf } from '../core/layout';
import { clip } from '../core/text';
import { agentFailed, type AppUpdate, type ProjectInfo, type BlockedClone, type ClonePool, finished, finishedArchivable, type Item, merging, needsYou, pausable, type PendingRestart, halted, type PoolHost, type PlanHistory, type SourceUpdate, stoppedArchivable } from '../core/types';
import { CardMore } from './canvases';
import { PlanTalk } from './koordinator';
import { api } from './api';
import type { Cam, Sides } from './camera';
import type { Shape } from './groups';
import { Doc, Inline, plain } from './markdown';
import { Body } from './message';
import { waitedOn } from './queue';
import { asksYou, CardFace, cardClass, hasLabels, HourglassMark, LabelMarks, LabelPicks, shownState } from './card';
import { scrollBehavior } from './motion';
import { clock, shortDay, stateLabel, t } from './strings';
import { edgeChipPositions } from './edgeChips';

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

/** The same limit pause and manual retry on every card's conversation. */
export function LimitNotice({ item }: { item: Item }) {
  if (!item.limitPaused && !item.limitedUntil) return null;
  return <div className="limit-notice">
    <HourglassMark />
    <div>{item.limitPaused ? t.limitPaused : t.limitedUntil(clock(item.limitedUntil!))}
      {item.limitPaused && item.limitedUntil && <div className="limit-reset">{t.limitedUntil(clock(item.limitedUntil))}</div>}
    </div>
    <button onClick={() => void api.act(item.id, { action: 'resume' }).catch(console.error)}><PlayMark /> {t.limitTryAgain}</button>
  </div>;
}

/**
 * On a card on the project, the pause of its agent at work, at a safe point, or the resume of its
 * paused one (or of one about to pause, which then works on): where a card's play and archive
 * buttons stand, faint, while the pointer is on the card.
 */
function CardTurn({ item }: { item: Item }) {
  const paused = halted(item);
  if (!paused && !pausable(item)) return null;
  return (
    <button
      className={paused ? 'play turn resume' : 'play turn'}
      title={item.pausing ? t.pause.takeBackHint : paused ? t.pause.resumeHint : t.pause.safeHint}
      aria-label={paused ? t.pause.resume : t.pause.button}
      // the project would take the press as the start of a drag or a click that opens the card
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void api.act(item.id, paused ? { action: 'resume' } : { action: 'pause', safePoint: true }).catch(() => {});
      }}
    >
      {paused ? <PlayMark /> : <PauseMark />}
    </button>
  );
}

/**
 * On a card on the project that Seismic is checking before its start, the Stop that calls the start
 * off: where its play stood, faint like the pause of an agent at work.
 */
function CardCheckStop({ item }: { item: Item }) {
  if (item.state !== 'planned' || !item.queue || !('checking' in item.queue)) return null;
  return (
    <button
      className="play turn"
      title={t.queue.checkingStopHint}
      aria-label={t.stop}
      // the project would take the press as the start of a drag or a click that opens the card
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void api.act(item.id, { action: 'dequeue' }).catch(() => {});
      }}
    >
      <Square className="btn-mark" size={10} strokeWidth={1.75} fill="currentColor" aria-hidden />
    </button>
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

/**
 * An unworked card merged with another card (`partner`), on the project: both cards side by side, glued by
 * a spinner while an agent merges them, and by the merge mark once the merged card waits for the owner.
 */
function MergedPair({ item, partner, showRepo }: { item: Item; partner?: Item; showRepo: boolean }) {
  return (
    <div className="merge-pair">
      <div className="merge-half">
        <CardFace item={item} where={showRepo ? item.repo : undefined} />
      </div>
      <div className="merge-glue" title={stateLabel(item)}>
        <span className="merge-knot">{merging(item) ? <span className="spinner" /> : <MergeMark />}</span>
      </div>
      <div className={`merge-half partner s-${partner?.state ?? 'planned'}`}>{partner ? <CardFace item={partner} where={showRepo ? partner.repo : undefined} /> : <div className="ttl untitled">{t.merge.gone}</div>}</div>
      {needsYou(item) && <div className="badge pulse">✦</div>}
    </div>
  );
}

/** Two lines joining into one: the mark of merging cards. */
export const MergeMark = ({ size = 16 }: { size?: number }) => (
  <GitMerge className="merge-mark" size={size} strokeWidth={size <= 13 ? 1.75 : 2} />
);

export const CardView = memo(
  function CardView({ item, partner, b, lifted, dragging, pop, prototyped, showRepo, els, onStart, onArchive, dep, onHover, underway }: CardProps) {
    const shape = shapeOf(item);
    // a card the Koordinator is checking has nothing to start yet
    const startable = !item.proposal?.merge && !item.mergingInto && item.state === 'planned' && (!item.queue || 'behind' in item.queue);
    // as "Archivieren" in the unfolded card: a finished card of the owner's whose agent is done, a
    // stopped task, or a parked or dropped idea without a prototype on the project
    const archivable =
      !item.archivedAt &&
      (finishedArchivable(item) || stoppedArchivable(item) || (!!item.idea && item.idea.status !== 'open' && !prototyped));
    const cls = [
      'item',
      cardClass(item, underway),
      shape,
      item.proposal?.merge && 'merged-pair',
      dep && `dep-${dep}`, lifted && 'lifted', dragging && 'dragging', pop && 'pop'].filter(Boolean).join(' ');
    return (
      <div
        className={cls}
        data-id={item.id}
        ref={(el) => void (el ? els.set(item.id, el) : els.delete(item.id))}
        style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 2 }}
        onPointerEnter={() => onHover(item.id)}
        onPointerLeave={() => onHover(null)}
      >
        {(dep === 'before' || dep === 'after') && <div className="dep-tag">{t.deps[dep]}</div>}
        {item.proposal?.merge ? (
          <MergedPair item={item} partner={partner} showRepo={showRepo} />
        ) : (
          <CardFace item={item} where={showRepo ? item.repo : undefined} underway={underway} chip={shape === 'chip'} />
        )}
        {!underway && <CardTurn item={item} />}
        {!underway && <CardCheckStop item={item} />}
        {startable && (
          <button
            className="play"
            title={item.queue ? t.queue.force : t.start}
            aria-label={item.queue ? t.queue.force : t.start}
            // the project would take the press as the start of a drag or a click that opens the card
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onStart(item);
            }}
          >
            <PlayIcon size={12} />
          </button>
        )}
        {archivable && (
          <button
            className={startable ? 'play archive beside' : 'play archive'}
            title={t.archive.archive}
            aria-label={t.archive.archive}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onArchive(item);
            }}
          >
            <Archive size={14} strokeWidth={2.25} />
          </button>
        )}
      </div>
    );
  },
  (a, b) =>
    a.item === b.item && a.partner === b.partner && sameBounds(a.b, b.b) && a.lifted === b.lifted && a.dragging === b.dragging && a.pop === b.pop && a.prototyped === b.prototyped && a.showRepo === b.showRepo && a.onStart === b.onStart && a.onArchive === b.onArchive && a.dep === b.dep && a.onHover === b.onHover && a.underway === b.underway,
);

/**
 * A project's agents on its row in the switcher (design: Pausing a project's agents): while one works
 * there, the moving line of a card at work, which turns into a pause for all of them while the
 * pointer is on the row; with none at work but some paused, a play that resumes them, on the same
 * hover. Where nothing hovers (touch), the button shows throughout.
 */
export function ProjectAgents({ project }: { project: ProjectInfo }) {
  const [asked, setAsked] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  // a scroll moves the button from under the tip
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    document.addEventListener('scroll', hide, true);
    return () => document.removeEventListener('scroll', hide, true);
  }, [tip]);
  const a = project.agents;
  if (!a) return null;
  const pause = a.running > 0;
  const label = pause ? t.projectPause.pause(a.running) : t.projectPause.resume(a.paused);
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAsked(true);
    setTip(null);
    (pause ? api.pauseAgents(project.id) : api.resumeAgents(project.id)).catch(console.error).finally(() => setAsked(false));
  };
  const show = (e: { currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.right + 10, y: r.top + r.height / 2 });
  };
  const hide = () => setTip(null);
  return (
    <span className={pause ? 'project-agents running' : 'project-agents'}>
      <button type="button" className="agents-turn" aria-label={`${label}: ${project.name}`} disabled={asked} onClick={click} onPointerEnter={show} onPointerLeave={hide} onFocus={(e) => e.currentTarget.matches(':focus-visible') && show(e)} onBlur={hide}>
        {pause ? <PauseMark /> : <PlayMark />}
      </button>
      {tip &&
        createPortal(
          <span className="agents-tip" style={{ left: tip.x, top: tip.y }}>
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

/** A restart that waits for workers or the owner: for whom and until when (on hover), and a button that has it go ahead now. */
export function RestartPill({ restart, items }: { restart: PendingRestart; items: Item[] }) {
  if (restart.repos) return <ReposRestartPill restart={restart} items={items} />;
  const n = restart.cards.length + restart.elsewhere.reduce((m, c) => m + c.cards.length, 0);
  const until = clock(restart.deadline);
  const owner = restart.owner;
  const stop = restart.reason === 'stop';
  const update = restart.reason === 'update';
  return (
    <Pill
      restart={restart}
      items={items}
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
function ReposRestartPill({ restart, items }: { restart: PendingRestart; items: Item[] }) {
  const r = t.restart.repos;
  return (
    <Pill
      restart={restart}
      items={items}
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
function Pill({ restart, items, elsewhere = [], go, going, say, until, now, risk, why, after }: {
  restart: PendingRestart;
  items: Item[];
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
  const titles = restart.cards.map((id) => plain(items.find((i) => i.id === id)?.title ?? id));
  const click = () => {
    setOn(true);
    go().then(
      (r) => r.restarting || setOn(false),
      () => setOn(false),
    );
  };
  if (on)
    return (
      <div className="pill restart going" id="restart">
        <span className="spin">↻</span> {going}
      </div>
    );
  return (
    <div className="pill restart" id="restart">
      <span className="spin">↻</span>
      <span className="say">{say}</span>
      {until && <span className="hint">{t.restart.until(clock(restart.deadline))}</span>}
      <button onClick={click}>
        {now}
        <span className="tip risk" role="tooltip">
          {risk}
        </span>
      </button>
      <div className="tip why" role="tooltip">
        {why}
        {titles.length + elsewhere.length > 0 && (
          <>
            <p>{t.restart.waits}</p>
            {titles.length > 0 && (
              <ul>
                {titles.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
            {elsewhere.map((c) => (
              <div key={c.project} className="elsewhere">
                <p className="hint">{t.restart.on(c.project)}</p>
                <ul>
                  {c.cards.map((x, i) => (
                    <li key={i}>{plain(x)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
        {after}
      </div>
    </div>
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
    <div className="pill restart update" id="update">
      <span>{t.update.pill(update.version)}</span>
      {update.download ? (
        <button onClick={() => window.open(update.download, '_blank')}>{t.update.download}</button>
      ) : (
        <button onClick={install} disabled={asked}>
          {t.update.install}
        </button>
      )}
      <div className="tip why" role="tooltip">
        <p>
          <b>{t.update.title(update.version, update.date ? shortDay(update.date) : null)}</b>
        </p>
        {update.notes && <Doc md={update.notes} />}
        <p className="hint">{update.download ? t.update.howDownload : t.update.how}</p>
      </div>
    </div>
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
    <div className={source.blocked ? 'pill restart update source by-hand' : 'pill restart update source'} id="source-update">
      <span>{t.source.pill(source.count)}</span>
      {!source.blocked && (
        <button onClick={pull} disabled={asked}>
          {t.source.pull}
        </button>
      )}
      <div className="tip why" role="tooltip">
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
        {source.error && <p className="warn">{t.source.failed(source.error)}</p>}
        <p className="hint">
          <Inline md={how} />
        </p>
      </div>
    </div>
  );
}

/**
 * The Bun the server runs on is too old (on Linux, before 1.3.14): it can deadlock, and then the
 * project stops loading. It stays in the bar for as long as the server runs on it; what to do, on hover.
 */
export function OldBunPill({ version }: { version: string }) {
  return (
    <div className="pill restart old-bun" id="old-bun">
      <span className="warn">⚠</span>
      <span className="say">{t.oldBun.pill(version)}</span>
      <div className="tip why" role="tooltip">
        <p>
          <b>{t.oldBun.title}</b>
        </p>
        <p>{t.oldBun.why(version)}</p>
        <p>
          <Inline md={t.oldBun.how} />
        </p>
      </div>
    </div>
  );
}

/**
 * Each repository's pool by machine: a dot per clone (solid while its card's worker is at work,
 * pale while the card holds it otherwise, orange while free but blocked), or per slot of a
 * repository in worktrees, and how many new cards could start now. Hovering or clicking it drops
 * down each machine's slots and each of its workstations by path with the card in it, which opens
 * the card (`onOpen`; `onElsewhere` one on another project), and why a blocked clone goes to no card
 * and what to do about it. While every clone is taken and a card waits for one, a faint "⋯" beside
 * a card opens what gives its clone to the one waiting longest (`onTake`); during the undo window
 * the row offers "Undo" (`onKeep`).
 */
export function WorkstationsPill({ pools, project, projects, items, onOpen, onElsewhere, onTake, onKeep }: {
  pools: ClonePool[];
  project: ProjectInfo;
  projects: ProjectInfo[];
  items: Item[];
  onOpen: (i: Item) => void;
  onElsewhere: (project: string, card: string) => void;
  onTake: (i: Item) => void;
  onKeep: (i: Item) => void;
}) {
  // open by a click (a tap) until one elsewhere or Escape; shut after a card is opened from it, until the pointer leaves
  const [open, setOpen] = useState(false);
  const [shut, setShut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => ref.current?.contains(e.target as Node) || setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // the pointer may still be over it: shut, not just unpinned
      setOpen(false);
      setShut(true);
    };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc);
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('keydown', esc);
    };
  }, [open]);
  const several = pools.length > 1;
  const name = (repo: string) => project.repos.find((r) => r.id === repo)?.name ?? repo;
  const forWorkstation = items.filter((i) => (i.queue && 'workstation' in i.queue && i.queue.workstation !== 'slots') || i.waitsForClone).length;
  const forSlot = items.filter((i) => i.queue && 'workstation' in i.queue && i.queue.workstation === 'slots').length;
  // a clone is taken from its card only while none is free and a card of its repository waits for one
  const wanted = (p: ClonePool) =>
    p.hosts.every((h) => h.cards.length + blocked(h) >= h.total) && items.some((i) => i.repo === p.repo && ((i.queue && 'workstation' in i.queue) || i.waitsForClone));
  const blocked = (h: PoolHost) => h.blocked?.length ?? 0;
  // a new card takes a free clone that is not blocked, on a machine whose busy workers leave it a slot
  const room = (h: PoolHost) => Math.max(0, Math.min(h.slots - h.busy.length, h.total - h.cards.length - blocked(h)));
  const free = (p: ClonePool) => p.hosts.reduce((n, h) => n + room(h), 0);
  const total = (p: ClonePool) => p.hosts.reduce((n, h) => n + h.total, 0);
  const blockedIn = (p: ClonePool) => p.hosts.reduce((n, h) => n + blocked(h), 0);
  const full = pools.every((p) => free(p) === 0);
  // the machines a pool names: those with clones or a clone's folder kept, and every other machine than this one
  const named = (p: ClonePool) => p.hosts.filter((h) => h.total > 0 || !h.here || h.kept?.length);
  const opened = (go: () => void) => {
    setOpen(false);
    setShut(true);
    go();
  };
  return (
    <div
      ref={ref}
      className={['pill workstations', full && 'full', open && 'open', shut && 'shut'].filter(Boolean).join(' ')}
      id="workstations"
      onPointerLeave={() => setShut(false)}
    >
      <button className="face" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="lbl">{t.workstations.label}</span>
        {pools.map((p) => {
          const hosts = named(p);
          return (
            <span key={p.repo} className="pool">
              {several && <span className="hint">{name(p.repo)}</span>}
              {hosts.map((h) => (
                <span key={h.name} className="host">
                  {hosts.length > 1 && <span className="hint">{h.name}</span>}
                  <span className="slots" aria-hidden>
                    {Array.from({ length: h.total }, (_, i) => (
                      <i key={i} className={i < h.busy.length ? 'on' : i < h.cards.length ? 'held' : i < h.cards.length + blocked(h) ? 'blocked' : undefined} />
                    ))}
                  </span>
                </span>
              ))}
              <b>{t.workstations.free(free(p), total(p), blockedIn(p))}</b>
              {blockedIn(p) > 0 && <b className="warn">{t.workstations.blockedCount(blockedIn(p))}</b>}
            </span>
          );
        })}
        <span className="hint drop">▾</span>
      </button>
      <div className="tip" role="dialog" aria-label={t.workstations.label}>
        {pools.map((p) => (
          <div key={p.repo}>
            {several && (
              <p>
                <b>{name(p.repo)}</b>
              </p>
            )}
            {named(p).map((h) => (
              <div key={h.name}>
                <p>
                  {h.worktrees
                    ? t.workstations.worktreeSlots(h.name, h.busy.length, h.slots, h.workstations.length > 0)
                    : t.workstations.host(h.name, h.busy.length, h.slots, h.cards.length, h.total)}
                </p>
                {h.workstations.length > 0 && (
                  <WorkstationRows
                    host={h}
                    items={items}
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
      </div>
    </div>
  );
}

/**
 * A machine's workstations, one per line: the dot the pill shows for it, its path (cut at the front
 * where it is too long, so its end stays), and the card in it, which opens on a click; or that it
 * is free, or blocked. With `onTake` (a card waits, none is free), a faint "⋯" beside each card
 * that may give its clone up, which opens the one action and what it does; a card giving it up has
 * "Undo" (`onKeep`) instead.
 */
function WorkstationRows({ host, items, projects, onOpen, onElsewhere, onTake, onKeep }: {
  host: PoolHost;
  items: Item[];
  projects: ProjectInfo[];
  onOpen: (i: Item) => void;
  onElsewhere: (project: string, card: string) => void;
  onTake?: (i: Item) => void;
  onKeep: (i: Item) => void;
}) {
  const blocked = new Set(host.blocked?.map((b) => b.path));
  // the row whose "⋯" is open
  const [more, setMore] = useState<string | null>(null);
  return (
    <ul className="ws-list">
      {host.workstations.map((w) => {
        const item = w.card && !w.project ? items.find((i) => i.id === w.card) : undefined;
        const busy = !!w.card && host.busy.includes(w.card);
        const state = busy ? 'on' : w.card ? 'held' : blocked.has(w.path) ? 'blocked' : 'free';
        const there = w.project && projects.find((c) => c.id === w.project);
        return (
          <li key={w.path} className={state}>
            <i aria-hidden />
            <span className="ws-path" title={w.path}>
              {/* the mark keeps the path's leading slash at its start in the right-to-left box that cuts it at the front */}
              {'\u200e' + w.path}
            </span>
            <span className="ws-card">
              {item ? (
                <a className="from" onClick={() => onOpen(item)}>
                  {plain(item.title)}
                </a>
              ) : w.card && there ? (
                <>
                  <a className="from" onClick={() => onElsewhere(there.id, w.card!)}>
                    {plain(w.title ?? '')}
                  </a>
                  <span className="hint"> · {t.workstations.onProject(there.name)}</span>
                </>
              ) : w.card ? (
                <span className="hint">{w.title ? t.workstations.notOnProject(plain(w.title)) : t.workstations.offProject}</span>
              ) : (
                <span className={state === 'blocked' ? 'warn' : 'hint'}>{state === 'blocked' ? t.workstations.blockedRow : t.workstations.freeRow}</span>
              )}
              {busy && !w.leaving && <span className="hint"> · {t.workstations.atWork}</span>}
              {item && w.leaving && (
                <>
                  <span className="hint"> · {t.workstations.leaving}</span>
                  <button className="btn ws-take" onClick={() => onKeep(item)}>
                    {t.undo}
                  </button>
                </>
              )}
              {item && w.takeable && onTake && (
                <button className="ws-more" title={t.workstations.more} aria-label={t.workstations.more} aria-expanded={more === w.path} onClick={() => setMore(more === w.path ? null : w.path)}>
                  ⋯
                </button>
              )}
            </span>
            {item && w.takeable && onTake && more === w.path && (
              <div className="ws-menu">
                <button
                  className="btn ws-take"
                  onClick={() => {
                    setMore(null);
                    onTake(item);
                  }}
                >
                  {t.workstations.take}
                </button>
                <span className="hint">{t.workstations.takeWhat}</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Why each of a machine's blocked clones goes to no card, and what the owner can do: a line per clone, one for all of an unreachable machine's. */
function BlockedClones({ host }: { host: PoolHost }) {
  const all = host.blocked ?? [];
  const away = all.filter((b) => b.why === 'unreachable').map((b) => b.path);
  const line = (b: BlockedClone) => {
    const tb = t.workstations.blocked;
    switch (b.why) {
      case 'dirty':
        return tb.dirty(b.path, b.files ?? [], b.more ?? 0);
      case 'broken':
        return tb.broken(b.path, b.error ?? '', !!b.made);
      case 'missing':
        return tb.missing(b.path, !!b.made);
      case 'failed':
        return tb.failed(b.path, b.error ?? '');
      case 'unreachable':
        return tb.unreachable(host.name, away);
    }
  };
  return (
    <>
      {all
        .filter((b, i) => b.why !== 'unreachable' || all.findIndex((x) => x.why === 'unreachable') === i)
        .map((b) => (
          <p key={b.path} className="warn">
            {line(b)}
          </p>
        ))}
    </>
  );
}

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
    const collapsed = !!item.collapsed;
    // the project would take the press as the start of a drag or a click that opens the plan
    const own = (e: React.PointerEvent) => e.stopPropagation();
    return (
      <div className={`item plan s-${item.state}${collapsed ? ' collapsed' : ''}`} data-id={item.id} style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 0 }}>
        <div className="head">
          <button
            className="fold"
            title={collapsed ? t.plan.expand : t.plan.collapse}
            aria-label={collapsed ? t.plan.expand : t.plan.collapse}
            aria-expanded={!collapsed}
            onPointerDown={own}
            onClick={(e) => {
              e.stopPropagation();
              onCollapse(item, !collapsed);
            }}
          >
            {collapsed ? <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" /> : <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />}
          </button>
          <span className="ttl">{plain(item.title)}</span>
          <span className="kind">{t.kind.plan}</span>
          {hasLabels(item) && <span className="head-labels"><LabelMarks item={item} /></span>}
          <span className="progress">{t.progress(live, kids.length)}</span>
          {/* collapsed, its workstreams are not on the project to arrange; its sheet still has the button */}
          {!collapsed && (item.arranging || arrangeable(kids)) && (
            <button
              className="head-btn arrange"
              disabled={item.arranging}
              title={`${t.plan.arrangeLong}. ${t.plan.arrangeHint}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onArrange(item);
              }}
            >
              <ColumnsIcon size={11} />
              {item.arranging ? t.plan.arranging : t.plan.arrange}
            </button>
          )}
          {startable > 0 && (
            <button
              className="head-btn start-all"
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
          <span className="plan-more" onPointerDown={own} onClick={(e) => e.stopPropagation()}>
            <CardMore item={item} floating />
          </span>
        </div>
        {/* a collapsed plan's workstreams, a mark each in its state's colour: a click opens one, unfolding from its mark */}
        {collapsed && (
          <div className="marks">
            {kids.map((k) => (
              <button
                key={k.id}
                ref={(el) => void (el ? els.set(k.id, el) : els.delete(k.id))}
                className={needsYou(k) ? 'mark yours' : 'mark'}
                title={plain(k.title)}
                aria-label={plain(k.title)}
                style={{ background: `var(--${shownState(k)})` }}
                onPointerDown={own}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(k);
                }}
              />
            ))}
          </div>
        )}
        {(replies > 0 || waiting > 0) && (
          <div className="badges">
            {/* its plan agent's answers: a speech bubble, unlike the count of workstreams that need the owner */}
            {replies > 0 && (
              <button
                className="badge replied pulse"
                title={t.plan.replied(replies)}
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
            )}
            {waiting > 0 && <div className="badge">{waiting}</div>}
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
  const planOf = new Map(placed.flatMap((p) => (p.item.kind === 'plan' && p.item.origin ? [[p.item.origin, p]] : [])));
  // both ways: the arrow joins the same two cards whichever of them waits
  const joined = new Set(waits.flatMap(([from, to]) => [`${standsFor(from)} ${standsFor(to)}`, `${standsFor(to)} ${standsFor(from)}`]));
  const paths = placed.flatMap(({ item, b }) => {
    const src =
      (item.state === 'proposal' || item.state === 'planned' || item.prototypeOf) && item.from ? (byId.get(item.from) ?? (item.prototypeOf ? planOf.get(item.prototypeOf) : undefined)) : undefined;
    if (!src || joined.has(`${src.item.id} ${item.id}`)) return [];
    return [<path key={item.id} d={linkPath(src.b, b)} />];
  });
  return (
    <svg id="links" width="1" height="1">
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
export function DepArrow({ cls, length = 30 }: { cls: 'lit' | 'lit-first'; length?: number }) {
  const w = depWidth(1);
  const head = depHead(1);
  const x = (head * 8) / 9 / 2 + 1;
  return (
    <svg className="dep-arrow" width={2 * x} height={length} aria-hidden>
      <line className={cls} x1={x} y1={0} x2={x} y2={length - head + (0.3 * head) / 9} strokeWidth={w} />
      <path className={`${cls} head`} d={DEP_HEAD} transform={`translate(${x + (head * 8) / 9 / 2} ${length - head}) rotate(90) scale(${head / 9})`} />
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
  const path = (cls: string) => ([k, [from, to]]: [string, [string, string]]) => (
    <path key={`${cls} ${k}`} className={cls} d={routeOf?.(from, to, byId.get(from)!, byId.get(to)!, depHead(s)) ?? linkPath(byId.get(from)!, byId.get(to)!, depHead(s))} strokeWidth={depWidth(s)} markerEnd={`url(#${cls}-arrow)`} />
  );
  return (
    <svg id="deps" width="1" height="1">
      <defs>
        {/* The line stops at the head's base (refX 0, a hair inside so no seam shows) and the head points
            on to the card; measured in the line's width, as `depHead` is. */}
        {['lit', 'lit-first', 'faint', 'done-dep'].map((cls) => (
          <marker key={cls} id={`${cls}-arrow`} className={cls} viewBox="0 0 9 8" refX="0.3" refY="4" markerUnits="strokeWidth" markerWidth={6} markerHeight={(6 * 8) / 9} orient="auto">
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
  return k?.label ?? plain((k ?? all.find((x) => x.id === id))?.title ?? '…');
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
  const inOrder = kids.some((k) => k.buildsOn) ? dependencyOrder(kids).map((id) => kids.find((k) => k.id === id)!) : kids;
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
    <Docked id="sheet" ref={box} on={!!on} className={reading ? 'reading' : undefined}>
      {planCard?.plan && reading && (
        <>
          <div className="read-head">
            <button className="back" onClick={() => onRead(null)}>
              ‹ {t.plan.back}
            </button>
            <span className="src">{planCard.plan.file}</span>
          </div>
          {shown ? (
            <Doc md={shown.markdown} mark={reading.mark} markRef={(el) => void (markEl.current = el)} />
          ) : (
            <p className="hint">{failed ? t.plan.failed : t.plan.loading}</p>
          )}
        </>
      )}
      {planCard?.plan && !reading && (
        <>
          <div className="p-kind">
            {planCard.archivedAt ? t.archivedPlan : t.planSheet}
            {planCard.archivedAt ? <LabelMarks item={planCard} /> : <LabelPicks item={planCard} />}
          </div>
          <h2>{plain(planCard.title)}</h2>
          {planCard.archivedAt && <p className="hint">{t.archive.planGone(new Date(planCard.archivedAt))}</p>}
          <div className="goal">
            <Inline md={planCard.plan.goal} />
          </div>
          <div className="src">{planCard.plan.file}</div>
          {!planCard.archivedAt && (
            <button className="btn read" onClick={() => onRead({})}>
              {t.plan.read}
            </button>
          )}
          {!planCard.archivedAt && startable > 0 && (
            <div className="start-all">
              <button className="btn primary" onClick={() => onStartAll(planCard, startable)}>
                {t.plan.startAll(startable)}
              </button>
              <p className="hint">{t.plan.startAllHint}</p>
            </div>
          )}
          {!planCard.archivedAt && (planCard.arranging || arrangeable(kids)) && (
            <div className="arrange">
              <button className="btn" disabled={planCard.arranging} onClick={() => onArrange(planCard)}>
                <ColumnsIcon size={12} />
                {planCard.arranging ? t.plan.arranging : t.plan.arrangeLong}
              </button>
              <p className="hint">{t.plan.arrangeHint}</p>
            </div>
          )}
          {history?.origin && (
            <button className="origin" ref={ref(history.origin.id)} onClick={() => onOpen(history.origin!)}>
              <span className="hint">{t.fromIdea}</span>
              <span>{plain(history.origin.title.replace(/^Plan-Doc:\s*/, ''))}</span>
            </button>
          )}
          <ol>
            {inOrder.map((k) => (
              <li key={k.id} ref={ref(k.id)} onClick={() => onOpen(k)}>
                <CardFace
                  item={k}
                  size="xs"
                  // its text from the plan doc stands below in full
                  text={false}
                  tail={
                    k.queue && 'behind' in k.queue
                      ? t.queue.behind(waitedOn(k.queue.behind, all, (id) => sibling(id, kids, all)))
                      : !finished(k.state) && !!k.buildsOn?.length && t.plan.buildsOn(k.buildsOn.map((id) => sibling(id, kids, all)))
                  }
                />
                {k.body.trim() && (
                  <div className="ws-text">
                    <Body md={k.body} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <PlanTalk on={on && !reading && talkLoaded} plan={planCard} talk={history?.talk ?? []} items={all} onOpen={onOpen} />
          <h4 className="p-h">{t.decisions}</h4>
          {history && history.decisions.length === 0 && <p className="hint">{t.noDecisions}</p>}
          {history && history.decisions.length > 0 && (
            <ul className="decisions">
              {history.decisions.map((d) => (
                <li key={d.id}>
                  <div className="q">{d.question}</div>
                  <div className="a">{d.answer}</div>
                  <div className="hint">
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
  const positions = new Map(edgeChipPositions(targets.map(({ item, b }) => ({ id: item.id, b })), cam, side, innerWidth, innerHeight).map((p) => [p.id, p]));
  return (
    <div id="edges">
      {targets.map(({ item }) => {
        const position = positions.get(item.id);
        if (!position) return null;
        const title = plain(item.title);
        return (
          <button key={item.id} className={`edge s-${item.state}`} style={{ left: position.x, top: position.y, transform: 'translateY(-50%)' }} onClick={() => onOpen(item)}>
            <span className="arr" style={{ transform: `rotate(${position.angle}deg)` }}>
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
      <svg viewBox={`0 0 ${W} ${H}`}>
        <g transform={`translate(${ox} ${oy}) scale(${k})`}>
          {territories.map(({ g, t: x }) => (
            <path key={g.id} className="mterr" d={x.main} fillRule="evenodd" style={{ '--h': g.hue } as React.CSSProperties} />
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
            style={{ fill: item.kind === 'plan' ? 'var(--container-line)' : `var(--${item.snoozed ? 'muted' : agentFailed(item) ? 'error' : asksYou(item) ? 'asking' : item.state})` }}
            opacity={item.kind === 'plan' || needsYou(item) ? 1 : 0.55}
          />
        ))}
        <rect
          x={ox + ((side.left - cam.x) / cam.s) * k}
          y={oy + (-cam.y / cam.s) * k}
          width={((innerWidth - side.left - side.right) / cam.s) * k}
          height={(innerHeight / cam.s) * k}
          fill="none"
          style={{ stroke: 'var(--ink)' }}
          strokeWidth={1.2}
          rx={1}
          opacity={0.5}
        />
      </svg>
    </div>
  );
}
