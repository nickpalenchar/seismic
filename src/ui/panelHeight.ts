


export const SNAP = 0.15;

export const FRICTION = 0.002;

export const THROWN = 0.3;

const TRAIL = 80;

const STILL = 50;

/**
 * Where the panel goes when its top is let go at `top` (0 the screen's top, 1 its bottom): within
 * `SNAP` of the top it takes the full height, within `SNAP` of the bottom it closes, and anywhere
 * between it stays as high as the owner left it. The answer is the panel's height as a share of the
 * screen, or `'close'`.
 */
export function settle(top: number): number | 'close' {
  if (top > 1 - SNAP) return 'close';
  if (top < SNAP) return 1;
  return 1 - top;
}


export type Mark = { t: number; y: number };

/**
 * How fast the finger moved down (px/ms, up negative) when it let go at `now`, from its last moves
 * (`trail`, the oldest first): over the last `TRAIL` ms of them, and none if it had not moved for
 * `STILL` ms.
 */
export function speed(trail: Mark[], now: number): number {
  const last = trail[trail.length - 1];
  if (!last || now - last.t > STILL) return 0;
  const recent = trail.filter((m) => last.t - m.t <= TRAIL);
  const first = recent[0]!;
  if (first === last) return 0;
  return (last.y - first.y) / Math.max(1, last.t - first.t);
}

/**
 * Where a top let go at `top` (a share of a screen `px` high) comes to rest when the finger was
 * moving at `v` px/ms: thrown, it glides on and slows by `FRICTION`; let go slower than `THROWN` it
 * stays.
 */
export function thrown(top: number, v: number, px: number): number {
  if (Math.abs(v) < THROWN) return top;
  return top + (Math.sign(v) * v * v) / (2 * FRICTION) / px;
}

/**
 * How the top glides `distance` px on from a finger let go at `v` px/ms: slowing evenly to a stop,
 * as long as that takes within bounds, and starting at the finger's speed (the curve's first slope)
 * as far as an easing without overshoot allows.
 */
export function glide(distance: number, v: number): { ms: number; ease: string } {
  const d = Math.max(1, Math.abs(distance));
  const s = Math.max(THROWN, Math.abs(v));
  const ms = Math.round(Math.min(500, Math.max(150, (2 * d) / s)));
  const slope = Math.min(3, (s * ms) / d);
  return { ms, ease: `cubic-bezier(.333, ${(slope / 3).toFixed(3)}, .667, 1)` };
}
