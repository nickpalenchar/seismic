// Full or reduced motion as the owner chose in the settings, else as the system's reduce-motion
// setting: reduced, `data-motion="reduce"` on the page's root takes the animations and blurs out of
// the stylesheets (styles.css, frost.css), and the code that moves things itself (camera flights,
// zooms, smooth scrolling) asks `reducedMotion` and goes there at once.

import type { Motion } from '../core/types';

const system = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let chosen: Motion | null = null;

function apply() {
  if (typeof document === 'undefined') return;
  const reduce = chosen ? chosen === 'reduced' : !!system?.matches;
  if (reduce) document.documentElement.dataset.motion = 'reduce';
  else delete document.documentElement.dataset.motion;
}

system?.addEventListener('change', apply);
apply();

/** Takes the owner's choice; `null` follows the system, also when that changes later. */
export function applyMotion(motion: Motion | null) {
  chosen = motion;
  apply();
}

/** Whether the page moves as little as it can. */
export const reducedMotion = () => typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce';

/** How a scroll the code asks for goes: smooth, or at once with reduced motion. */
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');

/** An animation's duration in ms, none with reduced motion. */
export const motionMs = (ms: number) => (reducedMotion() ? 0 : ms);

/**
 * Resolves once `el` has kept its size for `quietMs`, or after `capMs` at the latest: what opens
 * at once under reduced motion shows when the content that loads after it has arrived.
 */
export function sizeSettled(el: Element, quietMs: number, capMs: number): Promise<void> {
  return new Promise((done) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      ro.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      done();
    };
    const ro = new ResizeObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(end, quietMs);
    });
    const cap = setTimeout(end, capMs);
    ro.observe(el);
  });
}
