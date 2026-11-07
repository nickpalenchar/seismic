// A line above the microphone that the phone lets the owner swipe aside, to either side, to be rid
// of it before it goes by itself: Seismic's reply, a confirmation, a command still being read. Until
// the owner has swiped one away, each line nudges aside and back once after it appears.

import { type ReactNode, useRef, useState } from 'react';

/** How far a finger moves before the line follows it sideways, or the move counts as one up or down. */
const SLOP = 8;
/** How long the line takes to fly out or spring back. */
const SETTLE_MS = 180;
/** In this browser the owner has swiped a line aside: the lines no longer nudge. */
const SWIPED = 'obeya.swipedAside';

/**
 * Whether a line let go `dx` px aside (moving at `v` px/ms when let go) goes, `width` px wide:
 * pulled past a third of its width, or flicked the way it was pulled.
 */
export function goesAside(dx: number, v: number, width: number): boolean {
  if (Math.abs(dx) > width / 3) return true;
  return Math.abs(dx) > 24 && Math.abs(v) > 0.4 && Math.sign(v) === Math.sign(dx);
}

function swipedOnce(): boolean {
  try {
    return localStorage.getItem(SWIPED) === '1';
  } catch {
    return false;
  }
}

/**
 * A line above the microphone; with `on` (the phone) the owner swipes it aside and `onGone` drops
 * it. Without `on` it is a plain line.
 */
export function Aside({ on, onGone, id, className, children }: { on: boolean; onGone: () => void; id?: string; className: string; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const [held, setHeld] = useState(false);
  const press = useRef<{ id: number; x: number; y: number; dragging: boolean; last: { x: number; t: number }; v: number } | null>(null);
  const dragged = useRef(false);
  if (!on) return <div id={id} className={className}>{children}</div>;

  function letGo(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current;
    press.current = null;
    if (!p?.dragging) return;
    const now = e.clientX - p.x;
    const width = e.currentTarget.offsetWidth;
    setSettling(true);
    // a finger that stood still before it lifted flicked nothing
    const v = e.timeStamp - p.last.t > 80 ? 0 : p.v;
    if (e.type === 'pointerup' && goesAside(now, v, width)) {
      try {
        localStorage.setItem(SWIPED, '1');
      } catch {}
      setDx(Math.sign(now) * window.innerWidth);
      setTimeout(() => {
        onGone();
        setSettling(false);
        setDx(0);
        setHeld(false);
      }, SETTLE_MS);
    } else {
      setDx(0);
      setTimeout(() => {
        setSettling(false);
        setHeld(false);
      }, SETTLE_MS);
    }
  }

  const style = dx || settling
    ? { transform: `translateX(${dx}px)`, opacity: 1 - Math.min(1, Math.abs(dx) / (window.innerWidth * 0.8)), transition: settling ? `transform ${SETTLE_MS}ms ease-out, opacity ${SETTLE_MS}ms ease-out` : 'none' }
    : undefined;
  return (
    <div
      id={id}
      className={`${className} aside${!held && !swipedOnce() ? ' nudge' : ''}`}
      style={style}
      onPointerDown={(e) => {
        if (e.button !== 0 || settling) return;
        dragged.current = false;
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false, last: { x: e.clientX, t: e.timeStamp }, v: 0 };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        const mx = e.clientX - p.x;
        const my = e.clientY - p.y;
        if (!p.dragging) {
          if (Math.abs(my) > SLOP && Math.abs(my) > Math.abs(mx)) return void (press.current = null);
          if (Math.abs(mx) <= SLOP) return;
          p.dragging = true;
          dragged.current = true;
          setHeld(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        const dt = e.timeStamp - p.last.t;
        if (dt > 0) p.v = (e.clientX - p.last.x) / dt;
        p.last = { x: e.clientX, t: e.timeStamp };
        setDx(mx);
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      // a line pulled aside and let go is no tap on its "Undo"
      onClickCapture={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
