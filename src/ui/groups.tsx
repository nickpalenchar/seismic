



import { cn } from 'cn';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Bounds, centre } from '../core/layout';
import type { Group, Item } from '../core/types';
import { t } from './strings';
import { type Claim, type Territory, Territories } from './territory';
import { CloseButton } from './components/button';
import { ballClass, captionClass, countClass, haloClass, nameFieldClass, radialClass, ringBackClass, tagClass, tagDeleteClass } from './ringClasses';

type Placed = { item: Item; b: Bounds }[];
type Pt = { x: number; y: number };


const GROW_MS = 1100;

const WAVE_SPEED = 0.9;
const WAVE_MAX_DELAY = 900;

const WAVE_MS = 1700;

const SLOW_MS = 8;

interface Fade {
  from?: string;
  to?: string;
  t0: number;
  delay: number;
}
export interface Wave {
  key: number;
  x: number;
  y: number;
  hue: number;
  delay: number;
}

export interface Streak {
  key: number;
  group: string;
  delay: number;
}
export interface Shape {
  g: Group;
  t: Territory;
}


let origin: { ids: Set<string>; at: Pt; until: number } | null = null;
export function growFrom(ids: string[], at: Pt) {
  origin = { ids: new Set(ids), at, until: performance.now() + 5000 };
}

/** Springs past 1 a little and settles: the territory grows a bit too far and draws back. */
const spring = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-5 * x) * Math.cos(9 * x));

let effectKey = 0;

/**
 * The territories of the groups behind the cards on the canvas (a plan counts as one card, its
 * workstreams inside), animated while cards change group.
 */
export function useTerritories(placed: Placed, groups: Group[]): { shapes: Shape[]; waves: Wave[]; streaks: Streak[] } {
  const [engine] = useState(() => new Territories());
  const [fades] = useState(() => new Map<string, Fade>());
  
  const [known] = useState(() => new Map<string, Group>());
  for (const g of groups) known.set(g.id, g);
  const seen = useRef<Map<string, string | undefined> | null>(null);
  const [fx, setFx] = useState<{ waves: Wave[]; streaks: Streak[] }>({ waves: [], streaks: [] });
  const [tick, setTick] = useState(0);
  const top = useMemo(() => placed.filter((p) => !p.item.parent), [placed]);

  const signature = top.map((p) => `${p.item.id}:${p.item.group ?? ''}`).join(',');
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = new Map(top.map((p) => [p.item.id, p.item.group]));
    
    if (!before) return;
    const changed = top.filter((p) => before.get(p.item.id) !== p.item.group);
    if (!changed.length) return;
    const now = performance.now();
    const mine = origin && origin.until > now && changed.some((p) => origin!.ids.has(p.item.id));
    const centres = changed.map((p) => centre(p.b));
    const from = mine ? origin!.at : { x: centres.reduce((s, c) => s + c.x, 0) / centres.length, y: centres.reduce((s, c) => s + c.y, 0) / centres.length };
    if (mine) origin = null;
    const waves: Wave[] = [];
    const streaks = new Map<string, Streak>();
    let last = 0;
    changed.forEach((p, n) => {
      const c = centres[n]!;
      const delay = Math.min(WAVE_MAX_DELAY, Math.hypot(c.x - from.x, c.y - from.y) * WAVE_SPEED);
      const to = p.item.group;
      fades.set(p.item.id, { from: before.get(p.item.id), to, t0: now, delay });
      last = Math.max(last, delay);
      const g = to ? known.get(to) : undefined;
      if (!g) return;
      waves.push({ key: ++effectKey, ...c, hue: g.hue, delay });
      const s = streaks.get(g.id);
      if (!s || s.delay > delay) streaks.set(g.id, { key: ++effectKey, group: g.id, delay: delay + 250 });
    });
    const added = new Set([...waves.map((w) => w.key), ...[...streaks.values()].map((s) => s.key)]);
    setFx((f) => ({ waves: [...f.waves, ...waves], streaks: [...f.streaks, ...streaks.values()] }));
    setTimeout(
      () => setFx((f) => ({ waves: f.waves.filter((w) => !added.has(w.key)), streaks: f.streaks.filter((s) => !added.has(s.key)) })),
      last + WAVE_MS + 300,
    );
    setTick((n) => n + 1);
  }, [signature]);

  
  useEffect(() => {
    if (!fades.size) return;
    const frame = requestAnimationFrame(() => {
      const now = performance.now();
      for (const [id, f] of fades) if (now - f.t0 - f.delay > GROW_MS) fades.delete(id);
      setTick((n) => n + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [tick]);

  
  
  const last = useRef<{ at: number; shapes: Shape[]; later?: ReturnType<typeof setTimeout> }>({ at: -Infinity, shapes: [] });
  const shapes = useMemo(() => {
    const now = performance.now();
    const pause = engine.last.ms > SLOW_MS ? engine.last.ms * 1.5 : 0;
    clearTimeout(last.current.later);
    if (now - last.current.at < pause) {
      last.current.later = setTimeout(() => setTick((n) => n + 1), pause - (now - last.current.at));
      return last.current.shapes;
    }
    const fading = new Set<string>();
    const claims: Claim[] = top.map(({ item, b }) => {
      const f = fades.get(item.id);
      if (!f) return { id: item.id, b, w: item.group ? { [item.group]: 1 } : {} };
      const p = spring((now - f.t0 - f.delay) / GROW_MS);
      const w: Record<string, number> = {};
      if (f.to) w[f.to] = p;
      if (f.from) (w[f.from] = Math.max(0, 1 - p)), fading.add(f.from);
      return { id: item.id, b, w };
    });
    const ids = [...groups.map((g) => g.id), ...[...fading].filter((id) => !groups.some((g) => g.id === id) && known.has(id))];
    const shapes = engine.compute(claims, ids).map((x) => ({ g: known.get(x.group)!, t: x }));
    last.current = { at: now, shapes };
    return shapes;
  }, [top, groups, tick]);
  useEffect(() => () => clearTimeout(last.current.later), []);

  return { shapes, ...fx };
}

const hue = (h: number) => ({ '--h': h }) as React.CSSProperties;


const worldLayerClass = 'absolute left-0 top-0 overflow-visible pointer-events-none';


export const hintBubbleClass = 'max-w-[300px] m-0 py-1.5 px-2.5 rounded-xs bg-foreground text-background font-sans text-sm/[1.35] text-left';

/** The topmost current group whose painted territory contains the world point. */
export function groupAt(viewport: HTMLElement, at: Pt, groups: Group[]): string | undefined {
  const paths = viewport.querySelectorAll<SVGPathElement>('#territories path[data-group]');
  
  const group = Array.from(paths).reverse().find((path) =>
    groups.some((g) => g.id === path.dataset.group) && path.isPointInFill(at),
  );
  return group?.dataset.group;
}

/** The territories, in world coordinates under the cards; `selected`: the cards the colour ring is for. */
export function TerritoryLayer({ shapes, waves, streaks, selected }: { shapes: Shape[]; waves: Wave[]; streaks: Streak[]; selected: Bounds[] }) {
  return (
    <svg id="territories" className={cn(worldLayerClass, 'z-0')} width="1" height="1">
      {shapes.map(({ g, t: x }) => (
        
        
        <g key={g.id} style={hue(g.hue)}>
          <path data-group={g.id} className="[fill:hsl(var(--h)_80%_var(--tl)_/_var(--ta))] [transition:fill_.4s] far:[fill:hsl(var(--h)_80%_var(--tl)_/_calc(var(--ta)*1.7))]" d={x.main} fillRule="evenodd" />
          <path className="fill-none [stroke:hsl(var(--h)_90%_var(--tl)_/_var(--tga))] [stroke-width:calc(10px/var(--s))] [stroke-linejoin:round]" d={x.main} />
          <path className="fill-none [stroke:hsl(var(--h)_75%_var(--tel)_/_var(--tea))] [stroke-width:calc(1.8px/var(--s))] [stroke-linejoin:round]" d={x.main} />
          <path className="fill-none [stroke:hsl(var(--h)_70%_var(--tel)_/_.45)] [stroke-width:calc(1.2px/var(--s))] [stroke-dasharray:1_9] [stroke-linecap:round]" d={x.inner} />
          {streaks
            .filter((s) => s.group === g.id)
            .map((s) => (
              <path key={s.key} className="fill-none [stroke:hsl(var(--h)_95%_72%)] [stroke-width:calc(3px/var(--s))] [stroke-linecap:round] [stroke-dasharray:9_91] [filter:drop-shadow(0_0_4px_hsl(var(--h)_95%_60%))] opacity-0 animate-[streak_1.4s_ease-in-out_both] reduced:hidden" d={x.main} pathLength={100} style={{ animationDelay: `${s.delay}ms` }} />
            ))}
        </g>
      ))}
      {waves.map((w) => (
        <circle key={w.key} className="fill-none [stroke:hsl(var(--h)_85%_var(--tl))] [stroke-width:3] opacity-0 [r:0] animate-[wave_.9s_cubic-bezier(.2,.7,.3,1)_both] reduced:hidden" cx={w.x} cy={w.y} style={{ ...hue(w.hue), animationDelay: `${w.delay}ms` }} />
      ))}
      {selected.map((b, n) => (
        <rect key={n} className="fill-none [stroke:var(--foreground)] [stroke-width:calc(2px/var(--s))] [stroke-dasharray:6_5] opacity-55 animate-[halo-drift_4s_linear_infinite]" x={b.x - 7} y={b.y - 7} width={b.w + 14} height={b.h + 14} rx={4} />
      ))}
    </svg>
  );
}

/** The groups' names over their territories, shown when zoomed far out. */
export function GroupNames({ shapes }: { shapes: Shape[] }) {
  return (
    <svg id="gnames" className={cn(worldLayerClass, 'z-5')} width="1" height="1">
      {shapes.map(
        ({ g, t: x }) =>
          x.label && (
            <text key={g.id} className="font-extrabold tracking-[.14em] uppercase [text-anchor:middle] [dominant-baseline:central] [fill:hsl(var(--h)_60%_var(--tel)_/_var(--tna))] opacity-0 [transition:opacity_.5s] far:opacity-100" x={x.label.x} y={x.label.y} style={{ ...hue(g.hue), fontSize: `calc(${x.labelSize}px / var(--s))` }}>
              {g.name}
            </text>
          ),
      )}
    </svg>
  );
}



/** The lasso the owner draws with Shift held, in screen coordinates. */
export function Lasso({ pts }: { pts: Pt[] }) {
  if (pts.length < 2) return null;
  const d = `M${pts.map((p) => `${p.x},${p.y}`).join('L')}Z`;
  const head = pts[pts.length - 1]!;
  return (
    <svg id="lasso" className="fixed inset-0 w-full h-full z-40 pointer-events-none">
      <path className="[fill:--alpha(var(--working)/8%)]" d={d} />
      <path className="fill-none [stroke:--alpha(var(--working)/25%)] [stroke-width:9] [stroke-linejoin:round]" d={d} />
      <path className="fill-none stroke-working [stroke-width:2] [stroke-dasharray:7_6] [stroke-linejoin:round] animate-[halo-drift_3s_linear_infinite]" d={d} />
      <circle className="fill-working" cx={head.x} cy={head.y} r={5} />
    </svg>
  );
}



/** Three colour balls, as in the ring. */
const RingIcon = () => (
  <svg className="[&_circle]:[fill:hsl(var(--h)_75%_55%)]" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    {[200, 30, 140].map((h, n) => (
      <circle key={h} cx={8 + 4.6 * Math.sin((n * 2 * Math.PI) / 3)} cy={8.6 - 4.6 * Math.cos((n * 2 * Math.PI) / 3)} r={3} style={hue(h)} />
    ))}
  </svg>
);

/**
 * Over the top right corner of what is marked (`at`, screen; `below` its bottom right one): how many, the button that opens the
 * colour ring for them and, until the owner has once moved several together, how that goes.
 */
export function Marked({ at, below, count, hint, onGroup }: { at: Pt; below: boolean; count: number; hint?: string; onGroup: (at: Pt) => void }) {
  return (
    <div
      id="marked"
      className={cn('fixed z-40 flex flex-col items-end gap-1.5', below ? '[transform:translate(-100%,12px)]' : '[transform:translate(-100%,calc(-100%_-_12px))]')}
      style={{ left: at.x, top: at.y }}
    >
      <div className="flex items-center gap-2 py-1 pr-1 pl-2.5 rounded-xs bg-card [box-shadow:var(--shadow)] whitespace-nowrap">
        <span className="font-sans text-sm/none font-medium text-muted-foreground">{t.marked.count(count)}</span>
        <button
          className="mgroup flex items-center gap-1.5 py-1 pr-2.5 pl-2 [border:0] rounded-xs bg-transparent text-foreground font-sans text-sm/none font-semibold cursor-pointer hover:bg-foreground/8"
          title={t.marked.groupTip}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onGroup({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
          }}
        >
          <RingIcon />
          {t.marked.group}
        </button>
      </div>
      {hint && <p className={hintBubbleClass}>{hint}</p>}
    </div>
  );
}

/** After the owner moved a single card, until they have once marked cards: how to move several at once, at `at` (screen). */
export function MarkHint({ at, text }: { at: Pt; text: string }) {
  return (
    <p id="markhint" className={cn(hintBubbleClass, 'fixed z-40 pointer-events-none [transform:translate(14px,14px)] animate-[markhint_7s_both] reduced:animate-none!')} style={{ left: at.x, top: at.y }}>
      {text}
    </p>
  );
}

/** Whether `p` lies inside the polygon. */
export function inside(p: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}



type Ball = { kind: 'group'; g: Group } | { kind: 'new' } | { kind: 'none' };
const RADIUS = 84;

const LABEL_RADIUS = 124;

const LABEL_MAX = 140;
const RING_MARGIN = 120;

/**
 * A ring of colour balls around `at` (screen): the groups, each with its name and how many of its
 * cards are still to be done beside it, a new one, none. Moving towards a ball or onto its name picks it, a click takes it; a new group asks for its
 * name first. The picked group's name carries a × that deletes the group.
 */
export function Ring({
  at: pointer,
  count,
  groups,
  open: openCards,
  onPick,
  onCreate,
  onDelete,
  onClose,
}: {
  at: Pt;
  count: number;
  groups: Group[];
  
  open: Map<string, number>;
  onPick: (group: string | null) => void;
  onCreate: (name: string) => void;
  onDelete: (group: Group) => void;
  onClose: () => void;
}) {
  
  const mx = groups.length ? LABEL_RADIUS + LABEL_MAX : RING_MARGIN;
  const my = groups.length ? LABEL_RADIUS + 24 : RING_MARGIN;
  const at = { x: Math.min(Math.max(pointer.x, mx), innerWidth - mx), y: Math.min(Math.max(pointer.y, my + 50), innerHeight - my) };
  const balls: Ball[] = [...groups.map((g) => ({ kind: 'group' as const, g })), { kind: 'new' }, { kind: 'none' }];
  const [hot, setHot] = useState(-1);
  const [naming, setNaming] = useState(false);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const angle = (k: number) => -Math.PI / 2 + (k * 2 * Math.PI) / balls.length;
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    addEventListener('keydown', key, true);
    return () => (cancelAnimationFrame(frame), removeEventListener('keydown', key, true));
  }, []);
  useEffect(() => {
    if (naming) input.current?.focus();
  }, [naming]);
  /** The ball in the direction of the pointer; none near the middle. */
  function aimed(e: React.PointerEvent): number {
    const dx = e.clientX - at.x;
    const dy = e.clientY - at.y;
    if (Math.hypot(dx, dy) < 30) return -1;
    const a = Math.atan2(dy, dx);
    let best = 0;
    let bd = Infinity;
    balls.forEach((_, k) => {
      const d = Math.abs(Math.atan2(Math.sin(a - angle(k)), Math.cos(a - angle(k))));
      if (d < bd) [bd, best] = [d, k];
    });
    return best;
  }
  
  function pick(k: number) {
    const b = balls[k];
    if (!b) return onClose();
    if (b.kind === 'new') return setNaming(true);
    onPick(b.kind === 'group' ? b.g.id : null);
  }
  const hb = balls[hot];
  const caption = naming ? '' : !hb ? t.groups.cards(count) : hb.kind === 'group' ? hb.g.name : hb.kind === 'new' ? t.groups.create : t.groups.none;
  return (
    <div id="ringback" className={ringBackClass} onPointerMove={(e) => naming || setHot(aimed(e))} onPointerDown={(e) => (e.preventDefault(), naming ? onClose() : pick(aimed(e)))} onContextMenu={(e) => e.preventDefault()}>
      <div className={radialClass} style={{ left: at.x, top: at.y }}>
        <div className={haloClass(open)} />
        {balls.map((b, k) => (
          <div
            key={b.kind === 'group' ? b.g.id : b.kind}
            className={ballClass(b.kind, { open, hot: k === hot })}
            aria-label={b.kind === 'group' ? b.g.name : b.kind === 'new' ? t.groups.create : t.groups.none}
            style={
              {
                '--h': b.kind === 'group' ? b.g.hue : 0,
                '--bx': `${Math.cos(angle(k)) * RADIUS}px`,
                '--by': `${Math.sin(angle(k)) * RADIUS}px`,
                transitionDelay: `${k * 28}ms`,
              } as React.CSSProperties
            }
          >
            {b.kind === 'new' ? '+' : b.kind === 'none' ? '∅' : ''}
          </div>
        ))}
        {balls.map(
          (b, k) =>
            b.kind === 'group' && (
              
              <div
                key={`n-${b.g.id}`}
                className={tagClass({ open, hot: k === hot, vacant: !openCards.get(b.g.id) })}
                title={b.g.name}
                style={
                  {
                    '--h': b.g.hue,
                    maxWidth: LABEL_MAX,
                    left: Math.cos(angle(k)) * LABEL_RADIUS,
                    top: Math.sin(angle(k)) * LABEL_RADIUS,
                    transform: `translate(${((Math.cos(angle(k)) - 1) / 2) * 100}%, ${((Math.sin(angle(k)) - 1) / 2) * 100}%)`,
                    transitionDelay: `${k * 28 + 80}ms`,
                  } as React.CSSProperties
                }
                onPointerMove={(e) => (e.stopPropagation(), naming || setHot(k))}
                onPointerDown={(e) => (e.preventDefault(), e.stopPropagation(), naming ? onClose() : pick(k))}
              >
                <span>{b.g.name}</span>
                {k === hot && !naming && (
                  <CloseButton label={t.groups.remove} size="small" className={tagDeleteClass} onPointerDown={(e) => (e.preventDefault(), e.stopPropagation(), onDelete(b.g))} />
                )}
                <b className={countClass(!openCards.get(b.g.id))} title={t.groups.open(openCards.get(b.g.id) ?? 0)}>
                  {openCards.get(b.g.id) ?? 0}
                </b>
              </div>
            ),
        )}
        <div className={captionClass}>{caption}</div>
        {naming && (
          <input
            ref={input}
            className={nameFieldClass}
            placeholder={t.groups.name}
            maxLength={60}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              
              e.stopPropagation();
              const name = e.currentTarget.value.trim();
              if (e.key === 'Enter' && name) onCreate(name);
            }}
          />
        )}
      </div>
    </div>
  );
}
