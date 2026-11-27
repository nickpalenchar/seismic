




import { type RefObject, useLayoutEffect } from 'react';

export const STEPS = 4;

/** The first step at which the contents fit, the last when none does. */
export function firstFit(fits: (step: number) => boolean, steps = STEPS): number {
  for (let s = 0; s < steps; s++) if (fits(s)) return s;
  return steps;
}

/** As an attribute the stylesheet can test for each step reached: "1 2" at step 2. */
export const stepsUpTo = (step: number) => Array.from({ length: step }, (_, i) => i + 1).join(' ');

/** Sets the bar's step: its right end (`.right`, pushed out once the bar overflows) within its padding. */
export function fitBar(bar: HTMLElement) {
  const end = bar.querySelector<HTMLElement>(':scope > .right');
  if (!end) return;
  const step = firstFit((s) => {
    bar.dataset.fit = stepsUpTo(s);
    const room = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight);
    return end.getBoundingClientRect().right <= room + 0.5;
  });
  bar.dataset.fit = stepsUpTo(step);
}

/**
 * Fits the bar whenever it changes width (the window, a sheet opening or dragged wider) or its
 * contents change (a button appears, a count or the branch changes, the fonts arrive). Both
 * observers call back before the next paint, so a step never shows half-done. The floating row under
 * the bar fits the same way, with steps of its own.
 */
export function useBarFit(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const fit = () => fitBar(bar);
    fit();
    const size = new ResizeObserver(fit);
    size.observe(bar);
    const content = new MutationObserver(fit);
    content.observe(bar, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(fit);
    return () => {
      size.disconnect();
      content.disconnect();
    };
  }, []);
}
