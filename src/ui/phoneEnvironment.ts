



import { useEffect, useState } from 'react';
import { phoneInUse } from './api';
import { enterBreaksLines } from './composer';
import { forTouch } from './strings';

/**
 * Whether the page shows the phone view: on a phone, which has a coarse pointer and a short side
 * under 600 px whichever way it is held (a tablet and a narrow window at the desk keep the project).
 * `?view=phone` or `?view=project` in the address decides instead.
 */
export function phoneView(): boolean {
  const asked = new URLSearchParams(location.search).get('view');
  if (asked === 'phone' || asked === 'project') return asked !== 'project';
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

export function usePhoneEnvironment() {
  useState(() => {
    forTouch();
    enterBreaksLines();
    phoneInUse();
  });
  useEffect(watchKeyboard, []);
  useEffect(tapOpensKeyboard, []);
}


const TYPED = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** Whether the element is a text field: one the keyboard comes up for. */
const typesText = (el: unknown): el is HTMLTextAreaElement | HTMLInputElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TYPED.has(el.type));


const KEYBOARD_PX = 150;

/**
 * Marks the page while the keyboard is up (`ph-kb` on the root): a text field has the focus and the
 * height the page has is well below the tallest it had at this width. The keyboard closed with the
 * phone's own button leaves the focus in the field, so the focus alone does not tell (until
 * 2026-10-17 it did, and the microphone stayed hidden after that).
 */
function watchKeyboard() {
  const vv = window.visualViewport;
  const tallest = new Map<number, number>();
  const check = () => {
    const h = vv?.height ?? innerHeight;
    const w = Math.round(innerWidth);
    const top = Math.max(tallest.get(w) ?? 0, h);
    tallest.set(w, top);
    document.documentElement.classList.toggle('ph-kb', typesText(document.activeElement) && h < top - KEYBOARD_PX);
  };
  check();
  vv?.addEventListener('resize', check);
  addEventListener('resize', check);
  addEventListener('focusin', check);
  addEventListener('focusout', check);
  return () => {
    vv?.removeEventListener('resize', check);
    removeEventListener('resize', check);
    removeEventListener('focusin', check);
    removeEventListener('focusout', check);
    document.documentElement.classList.remove('ph-kb');
  };
}


const TAP_MS = 400;
const TAP_PX = 10;

/**
 * A tap into a text field while the keyboard is down only puts the cursor where the finger was and
 * brings the keyboard up. Left to Chrome, a tap on a word marked misspelled also opened its menu of
 * suggestions, and on the phone that closed the keyboard it had just begun to open. With the
 * keyboard up the tap is Chrome's again, and the suggestions open above it.
 */
function tapOpensKeyboard() {
  let down: { x: number; y: number; at: number; field: HTMLTextAreaElement | HTMLInputElement } | null = null;
  const start = (e: TouchEvent) => {
    const field = e.target instanceof Element ? e.target.closest('textarea, input') : null;
    const finger = e.touches[0];
    down =
      finger && e.touches.length === 1 && typesText(field) && !field.readOnly && !field.disabled && !document.documentElement.classList.contains('ph-kb')
        ? { x: finger.clientX, y: finger.clientY, at: e.timeStamp, field }
        : null;
  };
  const end = (e: TouchEvent) => {
    const tap = down;
    down = null;
    const finger = e.changedTouches[0];
    if (!tap || !finger || e.touches.length || e.timeStamp - tap.at > TAP_MS) return;
    if (Math.hypot(finger.clientX - tap.x, finger.clientY - tap.y) > TAP_PX) return;
    e.preventDefault();
    const { field } = tap;
    const at = document.caretPositionFromPoint?.(finger.clientX, finger.clientY);
    
    if (document.activeElement === field) field.blur();
    field.focus();
    if (at?.offsetNode === field) field.setSelectionRange(at.offset, at.offset);
  };
  addEventListener('touchstart', start, { capture: true, passive: true });
  addEventListener('touchend', end, { capture: true, passive: false });
  return () => {
    removeEventListener('touchstart', start, { capture: true });
    removeEventListener('touchend', end, { capture: true });
  };
}






export const viewClass =
  'ph-view fixed overscroll-contain [-webkit-overflow-scrolling:touch] pt-[env(safe-area-inset-top)] pr-[max(14px,env(safe-area-inset-right))] pl-[max(14px,env(safe-area-inset-left))] ph-landscape:[--ph-side:calc(112px+env(safe-area-inset-right))] ph-landscape:pr-(--ph-side) [&_:is(textarea,select,input,[data-slot=select-trigger])]:text-base';








export const pageClass = `${viewClass} inset-0 overflow-y-auto overflow-x-hidden pb-[calc(157px+env(safe-area-inset-bottom))] ph-landscape:pb-[calc(24px+env(safe-area-inset-bottom))] [&:has(~.ph-panel)]:pb-[max(calc(157px+env(safe-area-inset-bottom)),calc(var(--ph-panel,0px)+20px))] ph-landscape:[&:has(~.ph-panel)]:pb-[max(calc(24px+env(safe-area-inset-bottom)),calc(var(--ph-panel,0px)+20px))] after:content-[''] after:fixed after:inset-x-0 after:bottom-0 after:h-[calc(87px+env(safe-area-inset-bottom))] after:z-4 after:bg-[linear-gradient(transparent,var(--background)_65%)] after:pointer-events-none ph-landscape:after:hidden [.ph-kb_&]:after:hidden`;





export const barClass =
  'ph-bar sticky top-0 z-5 flex items-center gap-2.5 min-h-[52px] -mx-3.5 px-3.5 bg-background border-b border-border ph-landscape:min-h-[42px] ph-landscape:mr-[calc(-1*var(--ph-side))] ph-landscape:pr-[max(14px,env(safe-area-inset-right))]';

export const pageBarClass = `${barClass} py-1.5 ph-landscape:py-1`;

