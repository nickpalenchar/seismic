



import { Ellipsis, Pause } from 'lucide-react';
import type { CSSProperties } from 'react';
import { type AnimationEvent, useState } from 'react';
import { type BlockedClone, type ClonePool, inParkingLot, type Item, type PoolHost, type PoolWorkstation, type ProjectInfo, snoozeOf, stopped } from '../core/types';
import { plain } from './markdown';
import { CardFace, cardTone, stateVars } from './card';
import { t } from './strings';
import { cn } from 'cn';
import { Button, LinkButton } from './components/button';
import { Tooltip } from './components/tooltip';


const PULSING = new Set(['working', 'reviewing', 'approved']);
/**
 * Puts the pulse animations of an element (its `::before` and `::after`) on the document timeline's origin when they
 * start, so every pulsing dot and bar share, however late each one mounted, is on and off together. Hooked to
 * `animationstart`, which fires whenever the browser starts them, not only at the commit that mounted the element:
 * also when reduced motion is turned off again, or a class change brings the pulse back.
 */
function alignPulse(e: AnimationEvent<HTMLElement>) {
  if (e.animationName !== 'ws-pulse') return;
  for (const a of e.currentTarget.getAnimations({ subtree: true })) if ((a as CSSAnimation).animationName === 'ws-pulse') a.startTime = 0;
}






const pulse =
  "relative bg-c-subtle shadow-[0_0_1px_var(--c-subtle)] before:absolute before:-inset-px before:rounded-full before:shadow-[0_0_6px_var(--c)] before:content-[''] before:animate-[ws-pulse_2.4s_ease-in-out_infinite] after:absolute after:inset-0 after:rounded-full after:bg-c after:content-[''] after:animate-[ws-pulse_2.4s_ease-in-out_infinite] reduced:border-2 reduced:border-[var(--c)] reduced:bg-transparent reduced:shadow-none reduced:before:hidden reduced:after:animate-none reduced:after:inset-auto reduced:after:top-1/2 reduced:after:left-1/2 reduced:after:size-1 reduced:after:[transform:translate(-50%,-50%)]";


const barPulse =
  "relative bg-c-subtle after:absolute after:inset-0 after:bg-c after:content-[''] after:animate-[ws-pulse_2.4s_ease-in-out_infinite] reduced:after:animate-none";








type WorkstationDot = {
  className: string;
  style?: CSSProperties;
  paused?: boolean;
  
  fill?: string;
  pulsing?: boolean;
};

export function WorkstationMark({ dot, className }: { dot: WorkstationDot; className?: string }) {
  const props = { className: cn('shrink-0', 'size-3', className, dot.className), style: dot.style, 'aria-hidden': true } as const;
  return dot.paused ? <Pause {...props} size={12} fill="currentColor" strokeWidth={2} /> : <i onAnimationStart={alignPulse} {...props} />;
}

export function wsDot(w: PoolWorkstation | undefined, host: PoolHost, items: Item[], underway: Record<string, string>): WorkstationDot {
  const dot = 'ws-dot box-border block rounded-full border border-slate-500';
  if (!w?.card) {
    const blocked = !!w && !!host.blocked?.some((b) => b.path === w.path);
    return { className: cn(dot, blocked && 'shadow-[inset_0_0_0_1.5px_var(--waiting)]'), fill: blocked ? 'var(--waiting-wash)' : undefined };
  }
  const item = w.project ? undefined : items.find((i) => i.id === w.card);
  const tone = item ? cardTone(item, underway[item.id]) : host.busy.includes(w.card) ? 'working' : null;
  if (item?.hold?.reason === 'restart') return { className: 'block text-[var(--restart)]', paused: true, fill: 'var(--restart)' };
  if (!tone) return { className: cn(dot, 'bg-working/35'), fill: 'var(--working-wash)' };
  
  const pulsing = PULSING.has(tone) || (tone === 'idea' && !!host.exploring?.includes(w.card));
  return {
    className: cn(dot, pulsing ? pulse : 'bg-c'),
    style: stateVars(tone) as CSSProperties,
    fill: stateVars(tone)['--c'],
    pulsing,
  };
}

/**
 * How many of a machine's cards have an agent at work: workers in a turn, the code reviews whose
 * agent is at work on cards held there (one paused for a restart is not), and ideas whose agent
 * works on a reply. A review or an idea holds no slot, so the slot counts leave them out.
 */
export const atWorkOn = (h: PoolHost): number => h.busy.length + (h.reviewing?.length ?? 0) + (h.exploring?.length ?? 0);

/**
 * A machine's workstations in the order of its dots: each clone; in worktrees each card's worktree,
 * including those waiting on the owner, then working ideas and empty circles up to the cap.
 * Hidden slots leave no dot. Only workers in a turn count against the scheduling cap.
 */
export const hostSpots = (h: PoolHost, items: Item[]): (PoolWorkstation | undefined)[] => {
  const byId = new Map(items.map((i) => [i.id, i]));
  
  const shown = (w: PoolWorkstation) => {
    if (!w.card) return true;
    const i = byId.get(w.card);
    return !!i && !stopped(i) && !i.queue && !snoozeOf(i) && !inParkingLot(i);
  };
  const held = h.workstations.filter(shown);
  const ideas = (h.exploring ?? []).filter((card) => !held.some((w) => w.card === card)).map(ideaSpot).filter(shown);
  if (!h.worktrees) return [...held, ...ideas];
  const cards = held.filter((w): w is PoolWorkstation & { card: string } => !!w.card);
  if (h.uncapped) return [...cards, ...ideas];

  const busy = new Set(h.busy);
  
  const hidden = new Set(busy);
  for (const { card } of h.workstations) {
    const i = card && byId.get(card);
    if (i && (i.queue || snoozeOf(i))) hidden.add(i.id);
  }
  for (const { card } of cards) hidden.delete(card);
  const visibleBusy = cards.filter((w) => busy.has(w.card)).length;
  
  const visibleSlots = Math.min(h.slots, Math.max(visibleBusy, h.slots - hidden.size));
  if (cards.length > visibleSlots) cards.sort((a, b) => Number(busy.has(b.card)) - Number(busy.has(a.card)));
  const spots = [...cards, ...ideas].slice(0, visibleSlots);
  return [...spots, ...Array.from({ length: visibleSlots - spots.length }, () => undefined)];
};

/** The spot of an idea whose agent is at work (`PoolHost.exploring`), represented alongside the pool's workstations. */
const ideaSpot = (card: string): PoolWorkstation => ({ path: `idea:${card}`, card });

export const hostDots = (h: PoolHost, items: Item[], underway: Record<string, string>) => hostSpots(h, items).map((w) => wsDot(w, h, items, underway));

/**
 * A machine's workstations, one per line in the order of the pill's dots (`WorkstationRow`). With
 * `onTake` (a card waits, none is free), a faint "⋯" beside each card that may give its clone up.
 */
export function WorkstationRows({ host, items, underway, projects, onOpen, onElsewhere, onTake, onKeep }: {
  host: PoolHost;
  items: Item[];
  underway: Record<string, string>;
  projects: ProjectInfo[];
  onOpen: (i: Item) => void;
  onElsewhere: (project: string, card: string) => void;
  onTake?: (i: Item) => void;
  onKeep: (i: Item) => void;
}) {
  
  const [more, setMore] = useState<string | null>(null);
  return (
    <ul className="m-0 mb-0.5 list-none p-0">
      {hostSpots(host, items).map((w, n) => (
        <WorkstationRow key={w?.path ?? `slot-${n}`} w={w} host={host} items={items} underway={underway} projects={projects} onOpen={onOpen} onElsewhere={onElsewhere} onTake={onTake} onKeep={onKeep} more={more} onMore={setMore} />
      ))}
    </ul>
  );
}

/**
 * A workstation's line: the dot, the card in it as a compact card that opens on a click, and its
 * status and description; or that it is free, or blocked.
 * With `onTake`, a faint "⋯" beside a card that may give its clone up, which opens the one action
 * and what it does (`more`: the row whose "⋯" is open); a card giving it up has "Undo" (`onKeep`)
 * instead. Without a workstation (`w` undefined) a free slot of worktrees.
 */
export function WorkstationRow({ w, host, items, underway, projects, onOpen, onElsewhere, onTake, onKeep, more = null, onMore = () => {} }: {
  w: PoolWorkstation | undefined;
  host: PoolHost;
  items: Item[];
  underway: Record<string, string>;
  projects: ProjectInfo[];
  onOpen: (i: Item) => void;
  onElsewhere: (project: string, card: string) => void;
  onTake?: (i: Item) => void;
  onKeep: (i: Item) => void;
  more?: string | null;
  onMore?: (path: string | null) => void;
}) {
  const blocked = new Set(host.blocked?.map((b) => b.path));
  const dot = wsDot(w, host, items, underway);
  if (!w)
    return (
      <li className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-x-2 py-1">
        <WorkstationMark dot={dot} />
        <span className="hint col-start-2">{t.workstations.freeSlot}</span>
      </li>
    );
  const item = w.card && !w.project ? items.find((i) => i.id === w.card) : undefined;
  const busy = !!w.card && host.busy.includes(w.card);
  const state = w.card ? 'held' : blocked.has(w.path) ? 'blocked' : 'free';
  const there = w.project && projects.find((c) => c.id === w.project);
  return (
    <li className={cn('grid grid-cols-[12px_minmax(0,1fr)] gap-x-2', item ? 'items-start py-1' : 'items-center py-1')}>
      <WorkstationMark dot={dot} className={cn('row-start-1', item && (dot.paused ? 'mt-2' : 'mt-1'))} />
      <span className={cn('col-start-2 [overflow-wrap:anywhere]', item ? 'row-start-1 flex min-w-0 items-start gap-1' : 'row-start-1')}>
        {item ? (
          <button type="button" className="-mx-1.5 -my-0.5 block min-w-0 flex-1 cursor-pointer rounded-sm bg-transparent px-1.5 py-0.5 text-left text-inherit hover:bg-muted focus-visible:bg-muted [&_.f-dot]:hidden" onClick={() => onOpen(item)}>
            <CardFace item={item} size="xs" workstation underway={underway[item.id]} />
          </button>
        ) : w.card && there ? (
          <>
            <LinkButton onClick={() => onElsewhere(there.id, w.card!)}>{plain(w.title ?? '')}</LinkButton>
            <span className="hint"> · {t.workstations.onProject(there.name)}</span>
          </>
        ) : w.card ? (
          <span className="hint">{w.title ? t.workstations.notOnProject(plain(w.title)) : t.workstations.offProject}</span>
        ) : (
          <span className={state === 'blocked' ? 'text-warning' : 'hint'}>{state === 'blocked' ? t.workstations.blockedRow : t.workstations.freeRow}</span>
        )}
        {busy && !w.leaving && !item && <span className="hint"> · {t.workstations.atWork}</span>}
        {item && w.leaving && (
          <>
            <span className="hint"> · {t.workstations.leaving}</span>
            <Button size="small" className="ml-2" onClick={() => onKeep(item)}>
              {t.undo}
            </Button>
          </>
        )}
        {item && w.takeable && onTake && (
          <Tooltip content={t.workstations.more}>
            <button
              className="ml-1.5 inline-flex cursor-pointer items-center rounded-xs bg-transparent px-1 py-px align-middle text-muted-foreground opacity-55 hover:bg-muted hover:opacity-100 aria-expanded:bg-muted aria-expanded:opacity-100"
              aria-label={t.workstations.more}
              aria-expanded={more === w.path}
              onClick={() => onMore(more === w.path ? null : w.path)}
            >
              <Ellipsis size={14} aria-hidden />
            </button>
          </Tooltip>
        )}
      </span>
      {item && w.takeable && onTake && more === w.path && (
        <div className="col-start-2 mt-1 mb-0.5 flex flex-col items-start gap-1 rounded-xs bg-muted px-2.5 py-2 [--button-bg:var(--surface)]">
          <Button
            size="small"
            onClick={() => {
              onMore(null);
              onTake(item);
            }}
          >
            {t.workstations.take}
          </Button>
          <span className="hint leading-[1.4]">{t.workstations.takeWhat}</span>
        </div>
      )}
    </li>
  );
}

/** Why each of a machine's blocked clones goes to no card, and what the owner can do: a line per clone, one for all of an unreachable machine's. */
export function BlockedClones({ host }: { host: PoolHost }) {
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
          <p key={b.path} className="text-warning [overflow-wrap:anywhere]">
            {line(b)}
          </p>
        ))}
    </>
  );
}


/**
 * How a machine's dots fit the status bar's height: up to 5 in a row, 6 to 12 in two rows, 13 to 18
 * in three, smaller the more rows; from 19 on a bar whose coloured shares are its workstations.
 */
export const dotsLayout = (n: number): { rows: 1 | 2 | 3; cols: number } | 'bar' =>
  n <= 5 ? { rows: 1, cols: n } : n <= 12 ? { rows: 2, cols: Math.ceil(n / 2) } : n <= 18 ? { rows: 3, cols: Math.ceil(n / 3) } : 'bar';


const ROWS = { 1: { size: 'size-3', gap: 'gap-1' }, 2: { size: 'size-2.5', gap: 'gap-0.5' }, 3: { size: 'size-[7px]', gap: 'gap-0.5' } } as const;

/** Where each kind of workstation stands in the bar: at work first, free last, so its shares read as a ratio. */
function BarShare({ dot, n }: { dot: WorkstationDot; n: number }) {
  return (
    <i
      onAnimationStart={alignPulse}
      className={cn('block h-full', dot.pulsing && barPulse)}
      style={{ flexGrow: n, flexBasis: 0, ...(dot.pulsing ? dot.style : dot.fill && ({ '--c': dot.fill, background: dot.fill } as CSSProperties)) }}
    />
  );
}

const barOrder = (d: WorkstationDot) => (!d.fill ? 3 : d.pulsing ? 0 : d.paused ? 2 : 1);

/**
 * A machine's dots as the status bar shows them (`dotsLayout`): in a row, in two or three rows read
 * left to right, then top to bottom, as the list orders them; or, for many, one bar with a share per
 * colour as wide as its workstations are many (those at work first, the free ones an empty stretch at the end).
 */
export function DotsFace({ dots }: { dots: WorkstationDot[] }) {
  const layout = dotsLayout(dots.length);
  if (!dots.length) return null;
  if (layout === 'bar') {
    
    const shares: { dot: WorkstationDot; n: number }[] = [];
    for (const d of [...dots].sort((a, b) => barOrder(a) - barOrder(b))) {
      const last = shares.at(-1);
      if (last && last.dot.fill === d.fill) last.n++;
      else shares.push({ dot: d, n: 1 });
    }
    return (
      <span className="ws-bar box-border flex h-2.5 w-20 shrink-0 overflow-hidden rounded-full border border-slate-500" aria-hidden>
        {shares.map(({ dot, n }, i) => (
          <BarShare key={i} dot={dot} n={n} />
        ))}
      </span>
    );
  }
  const { size, gap } = ROWS[layout.rows];
  return (
    <span className={cn('ws-dots grid shrink-0', gap)} style={{ gridTemplateColumns: `repeat(${layout.cols}, max-content)` }} aria-hidden>
      {dots.map((d, i) => (
        <WorkstationMark key={i} dot={d} className={size} />
      ))}
    </span>
  );
}

/** Every pool's dots, a machine at a time as the status bar's pill shows them (`DotsFace`). */
export function WorkstationDots({ pools, items, underway }: { pools: ClonePool[]; items: Item[]; underway: Record<string, string> }) {
  const hosts = pools.flatMap((p) => p.hosts.map((h) => ({ key: `${p.repo}/${h.name}`, dots: hostDots(h, items, underway) }))).filter((h) => h.dots.length);
  
  return hosts.length ? (
    <span className="flex min-w-0 flex-wrap items-center gap-2" aria-hidden>
      {hosts.map((h) => (
        <DotsFace key={h.key} dots={h.dots} />
      ))}
    </span>
  ) : null;
}

/**
 * The cards agents are on, a line each as the pill lists its workstation (`WorkstationRow`); a card
 * that holds no workstation (its clone given back while it lands, say) has its dot and card alone.
 */
export function WorkingRows({ cards, pools, items, underway, projects, onOpen, onElsewhere, onKeep }: {
  cards: Item[];
  pools: ClonePool[];
  items: Item[];
  underway: Record<string, string>;
  projects: ProjectInfo[];
  onOpen: (i: Item) => void;
  onElsewhere: (project: string, card: string) => void;
  onKeep: (i: Item) => void;
}) {
  const spot = (id: string) => {
    for (const p of pools)
      for (const h of p.hosts) {
        const w = h.workstations.find((x) => x.card === id && !x.project) ?? (h.exploring?.includes(id) ? ideaSpot(id) : undefined);
        if (w) return { h, w };
      }
  };
  return (
    <ul className="m-0 list-none p-0">
      {cards.map((i) => {
        const at = spot(i.id);
        if (at) return <WorkstationRow key={i.id} w={at.w} host={at.h} items={items} underway={underway} projects={projects} onOpen={onOpen} onElsewhere={onElsewhere} onKeep={onKeep} />;
        const tone = cardTone(i, underway[i.id]);
        return (
          <li key={i.id} className="grid grid-cols-[12px_minmax(0,1fr)] items-start gap-x-2 py-1">
            <WorkstationMark dot={{ className: cn('ws-dot box-border block rounded-full border border-slate-500', PULSING.has(tone) ? pulse : 'bg-c'), style: stateVars(tone) as CSSProperties, pulsing: PULSING.has(tone) }} className="mt-1" />
            <button type="button" className="-mx-1.5 -my-0.5 block min-w-0 cursor-pointer rounded-sm bg-transparent px-1.5 py-0.5 text-left text-inherit hover:bg-muted focus-visible:bg-muted [&_.f-dot]:hidden" onClick={() => onOpen(i)}>
              <CardFace item={i} size="xs" workstation underway={underway[i.id]} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
