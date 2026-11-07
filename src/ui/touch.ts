// Touch on the canvas: which gesture the fingers make (tap, double-tap, long press, pan, pinch), apart
// from what the canvas does with it. The canvas's pointer handlers hand every touch pointer to a
// `Touches` and act on what it reports through a `TouchHost`; mouse and pen never come here.

import { type Cam, MAX_ZOOM, MIN_ZOOM, toWorld } from './camera';

export interface Pos {
  x: number;
  y: number;
}

/** Set once the owner has picked up a card or begun a lasso with a long press: the hint on it goes. */
export const TOUCH_HOLD_KNOWN = 'obeya-touch-hold-known';
/** How long a finger rests before a long press picks up the card under it, or starts the lasso. */
export const HOLD_MS = 400;
/** How far, in screen pixels, a finger may wander and still tap or hold rather than pan. */
export const SLOP = 10;
/** A second tap this soon and this near the first is a double-tap. */
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_PX = 30;

const mid = (a: Pos, b: Pos): Pos => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The view after two fingers moved from `from` to `to`: it zooms by how far they spread, within the
 * zoom limits, and the world point under their midpoint follows the midpoint, so pinch and pan go together.
 */
export function pinchCam(c: Cam, from: [Pos, Pos], to: [Pos, Pos]): Cam {
  const d0 = dist(...from);
  const d1 = dist(...to);
  const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, d0 > 0 ? (c.s * d1) / d0 : c.s));
  const m0 = mid(...from);
  const m1 = mid(...to);
  const w = toWorld(c, m0.x, m0.y);
  return { s, x: m1.x - w.x * s, y: m1.y - w.y * s };
}

/** What the canvas does with the gestures. `target` is what the first finger landed on: a card's id, or null for the empty canvas. */
export interface TouchHost {
  pan(dx: number, dy: number): void;
  pinch(from: [Pos, Pos], to: [Pos, Pos]): void;
  tap(at: Pos, target: string | null): void;
  doubleTap(at: Pos): void;
  /** A long press: the card is picked up, or on the empty canvas the lasso starts. */
  hold(at: Pos, target: string | null): void;
  holdMove(at: Pos): void;
  /** The finger let go of what it held; `cut` when a second finger or the browser ended the hold instead. */
  holdEnd(at: Pos, cut: boolean): void;
  /** Panning or pinching began (true) or every finger is off the glass (false). */
  moving(on: boolean): void;
}

export interface Clock {
  after(ms: number, f: () => void): unknown;
  cancel(h: unknown): void;
  now(): number;
}

const realClock: Clock = {
  after: (ms, f) => setTimeout(f, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

type Mode = 'idle' | 'press' | 'pan' | 'pinch' | 'hold' | 'done';

/** The fingers on the canvas and the gesture they make. */
export class Touches {
  private fingers = new Map<number, Pos>();
  private mode: Mode = 'idle';
  private start: Pos = { x: 0, y: 0 };
  private target: string | null = null;
  private timer: unknown = null;
  private lastTap: { at: Pos; t: number } | null = null;

  /** `host` may be swapped at any time: the canvas gives it the closures of its latest render. */
  constructor(
    public host: TouchHost,
    private clock: Clock = realClock,
  ) {}

  /** Whether fingers are on the canvas. */
  get busy() {
    return this.mode !== 'idle';
  }

  down(id: number, at: Pos, target: string | null) {
    if (this.fingers.size >= 2) return;
    this.fingers.set(id, at);
    if (this.fingers.size === 1) {
      this.mode = 'press';
      this.start = at;
      this.target = target;
      this.timer = this.clock.after(HOLD_MS, () => {
        this.timer = null;
        if (this.mode !== 'press') return;
        this.mode = 'hold';
        this.lastTap = null;
        this.host.hold(this.start, this.target);
      });
      return;
    }
    // a second finger: whatever the first did gives way to pinching, a held card staying where it is
    this.stopTimer();
    if (this.mode === 'hold') {
      const first = [...this.fingers.entries()].find(([k]) => k !== id)![1];
      this.host.holdEnd(first, true);
    }
    if (this.mode !== 'pan') this.host.moving(true);
    this.mode = 'pinch';
    this.lastTap = null;
  }

  move(id: number, at: Pos) {
    const was = this.fingers.get(id);
    if (!was) return;
    if (this.mode === 'pinch') {
      const other = [...this.fingers.entries()].find(([k]) => k !== id);
      this.fingers.set(id, at);
      if (other) this.host.pinch([was, other[1]], [at, other[1]]);
      return;
    }
    this.fingers.set(id, at);
    if (this.mode === 'press') {
      if (dist(at, this.start) < SLOP) return;
      this.stopTimer();
      this.mode = 'pan';
      this.lastTap = null;
      this.host.moving(true);
      // the stretch the finger moved before it counted as panning goes along
      this.host.pan(at.x - this.start.x, at.y - this.start.y);
    } else if (this.mode === 'pan') this.host.pan(at.x - was.x, at.y - was.y);
    else if (this.mode === 'hold') this.host.holdMove(at);
  }

  up(id: number, at: Pos) {
    this.lift(id, at, false);
  }

  /** The browser took the pointer away (a system gesture, say): nothing it did counts as a tap. */
  cancel(id: number, at: Pos) {
    this.lift(id, at, true);
  }

  private lift(id: number, at: Pos, cancelled: boolean) {
    if (!this.fingers.delete(id)) return;
    const mode = this.mode;
    if (mode === 'pinch') {
      // the finger that stays pans on; when it lets go too, that is no tap
      this.mode = this.fingers.size ? 'pan' : 'done';
    } else if (mode === 'press') {
      this.stopTimer();
      if (!cancelled) this.tapped(at);
    } else if (mode === 'hold') this.host.holdEnd(at, cancelled);
    if (this.fingers.size) return;
    if (mode === 'pan' || mode === 'pinch' || mode === 'done') this.host.moving(false);
    this.mode = 'idle';
  }

  private tapped(at: Pos) {
    const now = this.clock.now();
    const last = this.lastTap;
    if (this.target === null && last && now - last.t <= DOUBLE_TAP_MS && dist(at, last.at) <= DOUBLE_TAP_PX) {
      this.lastTap = null;
      this.host.doubleTap(last.at);
      return;
    }
    this.lastTap = this.target === null ? { at, t: now } : null;
    this.host.tap(at, this.target);
  }

  private stopTimer() {
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
  }
}

/** Gives a short buzz where the device can: a card picked up, the lasso begun. */
export const buzz = () => {
  try {
    navigator.vibrate?.(15);
  } catch {
    // some browsers refuse it without a user gesture they accept; the lift shows anyway
  }
};
