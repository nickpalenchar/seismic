import { type RefObject, useLayoutEffect, useRef } from 'react';

/** The height (border included) that holds a text box's text, or its placeholder, at its width as it stands. */
export function textHeight(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  return el.scrollHeight + el.offsetHeight - el.clientHeight;
}

/**
 * Sets a text box's height. Below its CSS max-height it does not scroll: `scrollHeight` is rounded,
 * and the fraction of a pixel it left over showed the box's scrollbar beside a text that fit.
 */
export function setHeight(el: HTMLTextAreaElement, h: number) {
  el.style.height = `${h}px`;
  el.style.overflowY = h < parseFloat(getComputedStyle(el).maxHeight) ? 'hidden' : '';
}

/**
 * Keeps a text box as tall as its text (within its CSS min- and max-height), on every change and
 * when its width changes. A card's content renders before its panel shows: a hidden box has no
 * height to measure and keeps its one line until it shows. `fit` optionally replaces the plain fitting.
 */
export function useFitHeight(
  ref: RefObject<HTMLTextAreaElement | null>,
  text: string,
  on = true,
  fit: (el: HTMLTextAreaElement) => void = (el) => setHeight(el, textHeight(el)),
) {
  const fitting = useRef(fit);
  fitting.current = fit;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const refit = () => {
      if (el.clientWidth) fitting.current(el);
    };
    refit();
    
    let width = el.clientWidth;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refit);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text, on]);
}
