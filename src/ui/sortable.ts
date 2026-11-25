








import { type CSSProperties, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type RefObject, useEffect, useRef, useState } from 'react';


export interface Reach {
  earlier: number;
  later: number;
}

export interface Drag {
  key: string;
  
  places: number;
  
  held?: 'earlier' | 'later';
}

interface Options {
  reach: (key: string) => Reach;
  
  drop: (key: string, places: number) => Promise<unknown>;
  
  scroller?: RefObject<HTMLElement | null>;
  
  fixed?: (key: string) => boolean;
}


const SLOP = 4;

const EDGE = 36;
const SCROLL = 14;

/** `keys` with `key` moved `places` places. */
export function moved(keys: string[], key: string, places: number): string[] {
  const n = keys.indexOf(key);
  if (n < 0 || !places) return keys;
  const out = keys.filter((k) => k !== key);
  out.splice(Math.max(0, Math.min(out.length, n + places)), 0, key);
  return out;
}

/** Where the dragged row, now from `top` to `bottom`, lands: past each row whose middle its edge has passed, within its reach. */
export function landing(mids: number[], from: number, top: number, bottom: number, reach: Reach): number {
  let to = from;
  while (to < mids.length - 1 && to - from < reach.later && bottom > mids[to + 1]!) to++;
  if (to > from) return to;
  while (to > 0 && from - to < reach.earlier && top < mids[to - 1]!) to--;
  return to;
}

export function useSortable(keys: string[], o: Options) {
  
  const joined = keys.join('\n');
  const [pending, setPending] = useState<{ of: string; key: string; places: number }>();
  const order = pending?.of === joined ? moved(keys, pending.key, pending.places) : keys;
  const [drag, setDrag] = useState<Drag & { dy: number; room: number }>();
  const at = useRef<Drag>(undefined);
  const rows = useRef(new Map<string, HTMLElement>());
  const latest = useRef(o);
  latest.current = o;
  
  const dragged = useRef(false);
  const stop = useRef<() => void>(undefined);

  
  
  useEffect(() => {
    if (pending && pending.of !== joined) setPending(undefined);
    return () => stop.current?.();
  }, [joined]);

  const begin = (key: string, e: ReactPointerEvent, now: boolean) => {
    
    if (e.button !== 0 || stop.current || order !== keys || latest.current.fixed?.(key)) return;
    const from = order.indexOf(key);
    const reach = latest.current.reach(key);
    if (from < 0) return;
    dragged.current = false;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const scroller = latest.current.scroller?.current;
    const top0 = scroller?.scrollTop ?? 0;
    const rects = order.map((k) => rows.current.get(k)?.getBoundingClientRect());
    if (rects.some((r) => !r)) return;
    const box = rects as DOMRect[];
    const own = box[from]!;
    const mids = box.map((r) => r.top + r.height / 2);
    
    const room = own.height + Math.max(0, box[from + 1] ? box[from + 1]!.top - own.bottom : box[from - 1] ? own.top - box[from - 1]!.bottom : 0);
    
    const min = box[from - reach.earlier]!.top - own.top;
    const max = box[from + reach.later]!.bottom - own.bottom;
    let y = y0;
    let started = now;
    let frame = 0;

    const update = () => {
      const raw = y - y0 + ((scroller?.scrollTop ?? 0) - top0);
      const dy = Math.max(min, Math.min(max, raw));
      const to = landing(mids, from, own.top + dy, own.bottom + dy, reach);
      const held = raw < min - 8 && from - reach.earlier > 0 ? 'earlier' : raw > max + 8 && from + reach.later < order.length - 1 ? 'later' : undefined;
      at.current = { key, places: to - from, held };
      setDrag({ ...at.current, dy, room });
    };
    const tick = () => {
      frame = 0;
      if (!scroller || !started) return;
      const r = scroller.getBoundingClientRect();
      const by = y < r.top + EDGE ? -Math.ceil(((r.top + EDGE - y) / EDGE) * SCROLL) : y > r.bottom - EDGE ? Math.ceil(((y - r.bottom + EDGE) / EDGE) * SCROLL) : 0;
      const before = scroller.scrollTop;
      if (by) scroller.scrollTop += by;
      if (scroller.scrollTop !== before) {
        update();
        frame = requestAnimationFrame(tick);
      }
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      y = ev.clientY;
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < SLOP) return;
        started = true;
        document.documentElement.classList.add('sorting');
      }
      ev.preventDefault();
      update();
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const end = (drop: boolean, released = true) => {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onCancel);
      scroller?.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      document.documentElement.classList.remove('sorting');
      stop.current = undefined;
      
      
      dragged.current = started;
      const done = () => setTimeout(() => (dragged.current = false));
      if (released) done();
      else addEventListener('pointerup', done, { once: true });
      const places = at.current?.places;
      at.current = undefined;
      setDrag(undefined);
      if (!drop || !places) return;
      setPending({ of: joined, key, places });
      latest.current.drop(key, places).catch(() => setPending(undefined));
    };
    const onUp = (ev: PointerEvent) => ev.pointerId === e.pointerId && end(started);
    const onCancel = (ev: PointerEvent) => ev.pointerId === e.pointerId && end(false);
    
    const onScroll = () => started && update();
    addEventListener('pointermove', onMove, { passive: false });
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    scroller?.addEventListener('scroll', onScroll);
    stop.current = () => end(false, false);
    if (now) {
      document.documentElement.classList.add('sorting');
      update();
    }
  };

  /** How far the row is shifted now: the dragged one with the pointer, those it passed by its height. */
  const shift = (key: string): number => {
    if (!drag) return 0;
    if (key === drag.key) return drag.dy;
    const n = order.indexOf(key);
    const from = order.indexOf(drag.key);
    const to = from + drag.places;
    if (from < n && n <= to) return -drag.room;
    if (to <= n && n < from) return drag.room;
    return 0;
  };

  return {
    
    order,
    /** Breaks a drag off, as when the list closes under it. */
    cancel: () => stop.current?.(),
    drag: drag && { key: drag.key, places: drag.places, held: drag.held },
    /** Spread on each row. */
    row: (key: string) => ({
      ref: (el: HTMLElement | null) => {
        if (el) rows.current.set(key, el);
        else rows.current.delete(key);
      },
      style: (drag ? { transform: `translateY(${shift(key)}px)`, ...(key === drag.key ? { position: 'relative', zIndex: 2 } : {}) } : undefined) as CSSProperties | undefined,
      'data-sorting': drag ? (key === drag.key ? 'dragged' : 'other') : undefined,
      onPointerDown: (e: ReactPointerEvent) => {
        
        if (e.pointerType !== 'mouse' || latest.current.fixed?.(key) || (e.target as Element).closest('button, a, input, textarea, .grip')) return;
        e.preventDefault();
        begin(key, e, false);
      },
      onClickCapture: (e: ReactMouseEvent) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
        e.preventDefault();
      },
    }),
    /** Spread on a row's grip: a drag starts at once. */
    grip: (key: string) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        begin(key, e, true);
      },
      onClick: (e: ReactMouseEvent) => e.stopPropagation(),
    }),
  };
}
