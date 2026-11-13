// Shared conversation panel for phone shells: layout, keyboard/landscape adjustments,
// dragging, focus on arrival and measurements used by the page and toast stack travel together.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Item } from '../core/types';
import { cn } from 'cn';
import { viewClass, barClass } from './phoneEnvironment';
import { glide, type Mark, settle, speed, THROWN, thrown } from './panelHeight';
import { scrollBehavior } from './motion';

/** The word a bar leads with, in frost's own font. */
export const wordClass = 'ph-word font-semibold leading-none [font-family:var(--font)]';
/** A panel's title in its grip, cut short; a card's (its title) smaller than Seismic's. */
export const gripWordClass = `${wordClass} text-[21px] overflow-hidden text-ellipsis whitespace-nowrap min-w-0 [.ph-panel:has(#ph-card-talk)_&]:text-[18px]`;

/**
 * Seismic's conversation in its panel: only the conversation scrolls, the field stands under it at
 * its own height. A card's names no heading over its conversation: the panel's top names the card.
 * `!`: the conversation's own sizes for a card's split view (`.split-talk`, which the card's panel
 * carries too) reach it with as much weight.
 */
export const talkClass =
  'ph-talk flex-1 min-h-0 flex flex-col justify-end pt-3 [&>:is(.conv,.talk)]:flex-[0_1_auto]! [&>:is(.conv,.talk)]:min-h-0! [&>:is(.conv,.talk)]:max-h-none! [&>:is(.conv,.talk)]:max-w-none! [&>[data-slot=prompt-input]]:max-w-none! [&>[data-slot=prompt-input]]:mt-2.5! [&>[data-slot=prompt-input]]:flex-none!';

/**
 * Seismic's conversation, or the open card's: a panel from below over the list, in the part of the
 * screen the keyboard leaves, `--ph-h` of it high (the one the owner dragged it to, set on the panel,
 * or the one it opens with: beside a demo video the lower half, so the video stays in view above it;
 * with the phone turned the full height, since half of 400 px leaves no room for a conversation).
 * Only the conversation scrolls, the field stands under it, and below that the room of the
 * microphone; while the keyboard is up the field has its own microphone and stands right above the
 * keyboard, and with the phone turned the microphone's strip is empty then, so the field takes its width.
 */
const panelClass = `${viewClass} ph-panel inset-x-0 top-[calc(100%*(1-var(--ph-h)))] bottom-auto h-[calc(100%*var(--ph-h))] z-20 overflow-hidden flex flex-col pb-[calc(87px+env(safe-area-inset-bottom))] ph-landscape:pb-[calc(24px+env(safe-area-inset-bottom))] [.ph-kb_&]:pb-2.5 ph-landscape:[.ph-kb_&]:pr-[max(14px,env(safe-area-inset-right))] bg-background shadow-[0_-6px_24px_rgba(0,0,0,.12)] animate-[ph-up_.22s_ease-out]`;

/**
 * The panel's top is its grip: the panel follows the finger up and down, and closes when let go near the
 * bottom. Its handle's colour comes through `--grip`: Tailwind's fallback for a color-mix on a
 * pseudo-element nests it where it never applies.
 */
const gripClass = `${barClass} ph-grip pt-3.5 pb-1.5 ph-landscape:pt-2.5 ph-landscape:pb-[3px] touch-none select-none cursor-ns-resize before:content-[''] before:absolute before:left-1/2 before:top-[5px] before:w-10 before:h-1 before:-ml-5 before:rounded-[2px] [--grip:color-mix(in_srgb,var(--ink)_22%,transparent)] before:bg-(--grip)`;

/** Opens beside a demo or a working card and brings its video above the panel.
 * The shell supplies its card page, so neither shell needs a private video selector or scroll fix.
 */
export function usePhoneCardPanel(open: string | null, talk: boolean, item: Item | undefined, pageRef: RefObject<HTMLElement | null>) {
  const [half, setHalf] = useState(false);
  const halfFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const now = open && talk && item ? open : null;
    if (now === halfFor.current) return;
    halfFor.current = now;
    setHalf(!!now && (!!pageRef.current?.querySelector('.demo-view video') || item?.state === 'working'));
  }, [open, talk, !!item]);
  useLayoutEffect(() => {
    const page = pageRef.current;
    const v = page?.querySelector<HTMLVideoElement>('.demo-view video');
    if (!half || !page || !v) return;
    const bar = page.querySelector('.ph-bar')?.getBoundingClientRect().bottom ?? 0;
    page.scrollTo({ top: page.scrollTop + v.getBoundingClientRect().top - bar - 10, behavior: scrollBehavior() });
  }, [half]);
  return half;
}

/**
 * A conversation as a panel from below, Seismic's or the open card's (`children`): the conversation is
 * the only thing in it that scrolls, the field stands under it and the microphone below that.
 * Its top is a grip the owner drags to the height they want (`settle`): let go near the screen's top
 * it takes the full height, near the bottom it closes (as the button beside the microphone and Back
 * do). Let go in motion, it glides on and slows down (`thrown`), so a short swipe throws it to the
 * full height or closes it. It opens at the full height, or beside a demo video (`half`) in the
 * lower half of the screen.
 */
export function TalkPanel({
  title,
  head,
  label,
  banner,
  half = false,
  onClose,
  leave: leaveRef,
  onLeave,
  focus,
  children,
}: {
  title: string;
  /** What the panel's head shows in place of the title. */
  head?: React.ReactNode;
  label: string;
  banner: React.ReactNode;
  half?: boolean;
  onClose: () => void;
  /** Where the panel puts its way of closing, for the button beside the microphone. */
  leave: React.RefObject<(() => void) | null>;
  /** The panel starts sliding out. */
  onLeave: () => void;
  /** Set: the cursor goes into the field once it is there. */
  focus?: React.RefObject<boolean>;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // the height the owner dragged it to, as a share of the screen the keyboard leaves; until then the
  // one it opens with
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => setHeight(null), [half]);
  const [leaving, setLeaving] = useState(false);
  /** Where the finger went down, where the panel's top stood then (a share of the screen the keyboard leaves, from its top), that screen's height in px, and where the finger has been since. */
  const drag = useRef<{ y: number; top: number; px: number; trail: Mark[] } | null>(null);
  // how a thrown panel glides on to where it comes to rest
  const [gliding, setGliding] = useState<{ ms: number; ease: string } | null>(null);
  const glided = useRef<ReturnType<typeof setTimeout>>(undefined);
  // the panel follows the finger without easing
  const [dragging, setDragging] = useState(false);
  const gone = useRef(false);
  const leave = (ms = 200) => {
    if (gone.current) return;
    gone.current = true;
    onLeave();
    setLeaving(true);
    setTimeout(onClose, ms);
  };
  leaveRef.current = leave;
  // the confirmations above the microphone stand above the field while the panel is open; the field
  // comes with the conversation, which may arrive after the panel
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const root = document.documentElement;
    let field: Element | null = null;
    // how far the field's top stands above the bottom of the screen (what sits below it counts)
    const measure = () => field && root.style.setProperty('--ph-field', `${Math.max(0, root.clientHeight - field.getBoundingClientRect().top)}px`);
    const size = new ResizeObserver(measure);
    size.observe(el);
    // the panel slides up when it opens: the field only stands in place once it has
    el.addEventListener('animationend', measure);
    addEventListener('resize', measure);
    visualViewport?.addEventListener('resize', measure);
    // the keyboard flag moves the field (the panel's bottom padding changes)
    const flag = new MutationObserver(measure);
    flag.observe(root, { attributes: true, attributeFilter: ['class'] });
    const find = () => {
      const f = el.querySelector('.composer');
      if (f === field) return;
      if (field) size.unobserve(field);
      field = f;
      if (!f) return root.style.removeProperty('--ph-field');
      size.observe(f);
      measure();
      if (focus?.current) {
        focus.current = false;
        f.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      }
    };
    const watch = new MutationObserver(find);
    watch.observe(el, { childList: true, subtree: true });
    find();
    return () => {
      watch.disconnect();
      size.disconnect();
      flag.disconnect();
      el.removeEventListener('animationend', measure);
      removeEventListener('resize', measure);
      visualViewport?.removeEventListener('resize', measure);
      root.style.removeProperty('--ph-field');
    };
  }, []);
  // the page under a panel lower than the screen scrolls on until all of it can stand above the panel
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const root = document.documentElement;
    const size = new ResizeObserver(() => root.style.setProperty('--ph-panel', `${el.getBoundingClientRect().height}px`));
    size.observe(el);
    return () => {
      size.disconnect();
      root.style.removeProperty('--ph-panel');
    };
  }, []);
  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button, select')) return;
    // the panel ends at the bottom of the screen the keyboard leaves and is its `--ph-h` share high,
    // so that screen's height comes from the panel alone, whether the page is pinned above the
    // keyboard or not
    const el = panel.current!;
    const share = parseFloat(getComputedStyle(el).getPropertyValue('--ph-h')) || 1;
    drag.current = { y: e.clientY, top: 1 - share, px: el.offsetHeight / share, trail: [{ t: e.timeStamp, y: e.clientY }] };
    e.currentTarget.setPointerCapture(e.pointerId);
    clearTimeout(glided.current);
    setGliding(null);
  };
  /** Where the dragged top stands, as a share of the screen from its top, with the finger at `y`. */
  const topAt = (y: number) => {
    const d = drag.current!;
    return d.top + (y - d.y) / d.px;
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.trail = [...drag.current.trail.filter((m) => e.timeStamp - m.t < 200), { t: e.timeStamp, y: e.clientY }];
    setDragging(true);
    setHeight(Math.min(1, 1 - topAt(e.clientY)));
  };
  const up = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const cancelled = e.type === 'pointercancel';
    // a cancelled touch may report no place of its own: it ends where the finger was last
    const y = cancelled ? drag.current.trail[drag.current.trail.length - 1]!.y : e.clientY;
    const moved = Math.abs(y - drag.current.y) > 4;
    const px = drag.current.px;
    // the top stands no higher than the screen's
    const at = Math.max(0, topAt(y));
    const v = cancelled ? 0 : speed(drag.current.trail, e.timeStamp);
    const to = settle(thrown(at, v, px));
    drag.current = null;
    setDragging(false);
    // a tap leaves the panel as it was
    if (!moved) return;
    let ms: number | undefined;
    if (Math.abs(v) >= THROWN) {
      // the way left to go: down out of the screen, or to the top's new place
      const g = glide(to === 'close' ? panel.current!.offsetHeight : (at - (1 - to)) * px, v);
      ms = g.ms;
      setGliding(g);
      glided.current = setTimeout(() => setGliding(null), g.ms);
    }
    if (to === 'close') leave(ms);
    else setHeight(to);
  };
  const style = {
    ...(height === null ? {} : { '--ph-h': Math.max(0, height) }),
    ...(gliding ? { transitionDuration: `${gliding.ms}ms`, transitionTimingFunction: gliding.ease } : {}),
  };
  return (
    <div
      id="ph-talk"
      className={cn(
        panelClass,
        half ? 'half [--ph-h:.52] ph-landscape:[--ph-h:1]' : '[--ph-h:1]',
        (half || (height ?? 1) < 1) && 'border-t border-line',
        (height ?? 1) < 1 && 'part',
        leaving && 'leaving [transform:translateY(100%)]',
        dragging ? 'dragging transition-none' : '[transition:transform_.2s_ease-out,top_.2s_ease-out,height_.2s_ease-out]',
      )}
      ref={panel}
      style={style as React.CSSProperties}
      role="dialog"
      aria-label={label}
    >
      <header className={gripClass} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {head ?? <span className={gripWordClass}>{title}</span>}
      </header>
      {banner}
      {children}
    </div>
  );
}
