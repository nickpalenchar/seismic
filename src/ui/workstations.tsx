// A machine's workstations as the status bar's pill lists them (a dot per workstation in the colour
// of its card's state, a line per workstation with its card), shared by the pill and the phone's
// working box.

import { Ellipsis, Pause } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { type BlockedClone, type ClonePool, inParkingLot, type Item, type PoolHost, type PoolWorkstation, type ProjectInfo, snoozeOf, stopped } from '../core/types';
import { plain } from './markdown';
import { CardFace, cardTone } from './card';
import { t } from './strings';
import { cn } from 'cn';
import { Button, LinkButton } from './components/button';
import { Tooltip } from './components/tooltip';

/** The colours of a card's state that pulse on its workstation's dot: at work, in review, landing. */
const PULSING = new Set(['working', 'reviewing', 'approved']);
/** The pulse of a dot at work (`ws-pulse` in frost.css); under reduced motion a ring in its colour around a dot that stands still. */
const pulse =
  "relative animate-[ws-pulse_3.6s_ease-in-out_infinite] reduced:animate-none reduced:border-2 reduced:border-[var(--c)] reduced:bg-transparent reduced:shadow-none reduced:after:absolute reduced:after:top-1/2 reduced:after:left-1/2 reduced:after:size-1 reduced:after:[transform:translate(-50%,-50%)] reduced:after:rounded-[50%] reduced:after:bg-[var(--c)] reduced:after:content-['']";

/**
 * A workstation's dot, the same on the pill and in its list: in the colour of its card's state as
 * the card shows it (`cardTone`), so it follows the cards' colours, pulsing slowly where the card is
 * at work, in review or landing; a card on another project solid while its worker is at work, else
 * pale; a pause symbol while held for restart; a ring while free, orange while blocked.
 * `w` is undefined for a free slot of worktrees.
 */
type WorkstationDot = { className: string; style?: CSSProperties; paused?: boolean };

export function WorkstationMark({ dot, className }: { dot: WorkstationDot; className?: string }) {
  const props = { className: cn('shrink-0', 'size-3', className, dot.className), style: dot.style, 'aria-hidden': true } as const;
  return dot.paused ? <Pause {...props} size={12} fill="currentColor" strokeWidth={2} /> : <i {...props} />;
}

export function wsDot(w: PoolWorkstation | undefined, host: PoolHost, items: Item[], underway: Record<string, string>): WorkstationDot {
  const dot = 'ws-dot box-border block rounded-full border border-[#6b7280]';
  if (!w?.card) return { className: cn(dot, w && host.blocked?.some((b) => b.path === w.path) ? 'shadow-[inset_0_0_0_1.5px_var(--waiting)]' : undefined) };
  const item = w.project ? undefined : items.find((i) => i.id === w.card);
  const tone = item ? cardTone(item, underway[item.id]) : host.busy.includes(w.card) ? 'working' : null;
  if (item?.hold?.reason === 'restart') return { className: 'block text-[var(--restart)]', paused: true };
  if (!tone) return { className: cn(dot, 'bg-[color-mix(in_srgb,var(--working)_35%,transparent)]') };
  return {
    className: cn(dot, 'bg-[var(--c)]', PULSING.has(tone) && pulse),
    style: { '--c': `var(--${tone})` } as CSSProperties,
  };
}

/**
 * How many of a machine's cards have an agent at work: workers in a turn, and the code reviews
 * whose agent is at work on cards held there (one paused for a restart is not). A review holds no
 * slot, so the slot counts leave it out.
 */
export const atWorkOn = (h: PoolHost): number => h.busy.length + (h.reviewing?.length ?? 0);

/**
 * A machine's workstations in the order of its dots: each clone; in worktrees each card's worktree,
 * then an empty circle for each slot no worker is busy in, up to the maximum (none without slots).
 * A waiting card keeps its worktree but its worker has released the slot; a hidden card's worker
 * can still occupy one.
 */
export const hostSpots = (h: PoolHost, items: Item[]): (PoolWorkstation | undefined)[] => {
  // a card that is stopped, queued, snoozed, parked or not on this project does not show: only cards at work or waiting on the owner here
  const shown = (w: PoolWorkstation) => {
    if (!w.card) return true;
    const i = items.find((x) => x.id === w.card);
    return !!i && !stopped(i) && !i.queue && !snoozeOf(i) && !inParkingLot(i);
  };
  const held = h.workstations.filter(shown);
  if (!h.worktrees) return held;
  const cards = held.filter((w) => w.card);
  // an empty circle for each slot without a busy worker, the pool's count (hidden cards included), as in the pill's summary
  return [...cards, ...Array.from({ length: h.uncapped ? 0 : Math.max(0, h.slots - h.busy.length) }, () => undefined)];
};

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
  // the row whose "⋯" is open
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
 * path (cut at the front where it is too long, so its end stays); or that it is free, or blocked.
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
      <li className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-x-2 py-[3px]">
        <WorkstationMark dot={dot} />
        <span className="hint col-start-2">{t.workstations.freeSlot}</span>
      </li>
    );
  const item = w.card && !w.project ? items.find((i) => i.id === w.card) : undefined;
  const busy = !!w.card && host.busy.includes(w.card);
  const state = w.card ? 'held' : blocked.has(w.path) ? 'blocked' : 'free';
  const there = w.project && projects.find((c) => c.id === w.project);
  const path = (
    <span className="col-start-2 overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-muted-foreground [direction:rtl] text-left" title={w.path}>
      {/* the mark keeps the path's leading slash at its start in the right-to-left box that cuts it at the front */}
      {'\u200e' + w.path}
    </span>
  );
  return (
    <li className={cn('grid grid-cols-[12px_minmax(0,1fr)] gap-x-2', item ? 'items-start py-1' : 'items-center py-[3px]')}>
      <WorkstationMark dot={dot} className={cn('row-start-1', item && (dot.paused ? 'mt-[7px]' : 'mt-[5px]'))} />
      {!item && path}
      <span className={cn('col-start-2 [overflow-wrap:anywhere]', item ? 'row-start-1 flex min-w-0 items-start gap-1' : 'row-start-2')}>
        {item ? (
          <button type="button" className="-mx-1.5 -my-0.5 block min-w-0 flex-1 cursor-pointer rounded-[6px] border-0 bg-transparent px-1.5 py-0.5 text-left text-inherit hover:bg-chip focus-visible:bg-chip [&_.f-dot]:hidden" onClick={() => onOpen(item)}>
            <CardFace item={item} size="xs" underway={underway[item.id]} />
          </button>
        ) : w.card && there ? (
          <>
            <LinkButton onClick={() => onElsewhere(there.id, w.card!)}>{plain(w.title ?? '')}</LinkButton>
            <span className="hint"> · {t.workstations.onProject(there.name)}</span>
          </>
        ) : w.card ? (
          <span className="hint">{w.title ? t.workstations.notOnProject(plain(w.title)) : t.workstations.offProject}</span>
        ) : (
          <span className={state === 'blocked' ? 'text-warn' : 'hint'}>{state === 'blocked' ? t.workstations.blockedRow : t.workstations.freeRow}</span>
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
              className="ml-1.5 inline-flex cursor-pointer items-center rounded-[3px] border-0 bg-transparent px-[3px] py-px align-middle text-muted-foreground opacity-55 hover:bg-chip hover:opacity-100 aria-expanded:bg-chip aria-expanded:opacity-100"
              aria-label={t.workstations.more}
              aria-expanded={more === w.path}
              onClick={() => onMore(more === w.path ? null : w.path)}
            >
              <Ellipsis size={14} aria-hidden />
            </button>
          </Tooltip>
        )}
      </span>
      {item && path}
      {item && w.takeable && onTake && more === w.path && (
        <div className="col-start-2 mt-1 mb-0.5 flex flex-col items-start gap-1 rounded-[3px] bg-chip px-2.5 py-2 [--button-bg:var(--panel)]">
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
          <p key={b.path} className="text-warn [overflow-wrap:anywhere]">
            {line(b)}
          </p>
        ))}
    </>
  );
}


/** Every pool's dots in one row, as the status bar's pill shows them. */
export function WorkstationDots({ pools, items, underway }: { pools: ClonePool[]; items: Item[]; underway: Record<string, string> }) {
  const dots = pools.flatMap((p) => p.hosts.flatMap((h) => hostDots(h, items, underway).map((d, n) => <WorkstationMark key={`${p.repo}/${h.name}/${n}`} dot={d} />)));
  // many workstations wrap onto further lines rather than push what stands beside the dots off a narrow screen
  return dots.length ? (
    <span className="flex min-w-0 flex-wrap items-center gap-[3px]" aria-hidden>
      {dots}
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
        const w = h.workstations.find((x) => x.card === id && !x.project);
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
            <WorkstationMark dot={{ className: cn('ws-dot box-border block rounded-full border border-[#6b7280] bg-[var(--c)]', PULSING.has(tone) && pulse), style: { '--c': `var(--${tone})` } as CSSProperties }} className="mt-[5px]" />
            <button type="button" className="-mx-1.5 -my-0.5 block min-w-0 cursor-pointer rounded-[6px] border-0 bg-transparent px-1.5 py-0.5 text-left text-inherit hover:bg-chip focus-visible:bg-chip [&_.f-dot]:hidden" onClick={() => onOpen(i)}>
              <CardFace item={i} size="xs" underway={underway[i.id]} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
