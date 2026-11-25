

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Item } from '../core/types';
import { cn } from 'cn';
import { viewClass, barClass } from './phoneEnvironment';
import { glide, type Mark, settle, speed, THROWN, thrown } from './panelHeight';
import { scrollBehavior } from './motion';


const wordClass = 'ph-word font-semibold leading-none [font-family:var(--font)]';

export const gripWordClass = `${wordClass} text-xl overflow-hidden text-ellipsis whitespace-nowrap min-w-0 [.ph-panel:has(#ph-card-talk)_&]:text-lg`;







export const talkClass =
  'ph-talk flex-1 min-h-0 flex flex-col justify-end pt-3 [&>:is(.conv,.talk)]:flex-[0_1_auto]! [&>:is(.conv,.talk)]:min-h-0! [&>:is(.conv,.talk)]:max-h-none! [&>:is(.conv,.talk)]:max-w-none! [&>[data-slot=prompt-input]]:max-w-none! [&>[data-slot=prompt-input]]:mt-2.5! [&>[data-slot=prompt-input]]:flex-none!';










const panelClass = `${viewClass} ph-panel inset-x-0 top-[calc(100%*(1-var(--ph-h)))] bottom-auto h-[calc(100%*var(--ph-h))] z-20 overflow-hidden flex flex-col pb-[calc(87px+env(safe-area-inset-bottom))] ph-landscape:pb-[calc(24px+env(safe-area-inset-bottom))] [.ph-kb_&]:pb-2.5 ph-landscape:[.ph-kb_&]:pr-[max(14px,env(safe-area-inset-right))] bg-background shadow-[0_-6px_24px_--alpha(black/12%)] animate-[ph-up_.22s_ease-out]`;






const gripClass = `${barClass} ph-grip pt-3.5 pb-1.5 ph-landscape:pt-2.5 ph-landscape:pb-1 touch-none select-none cursor-ns-resize before:content-[''] before:absolute before:left-1/2 before:top-[5px] before:w-10 before:h-1 before:-ml-5 before:rounded-xs [--grip:--alpha(var(--foreground)/22%)] before:bg-(--grip)`;

/** Opens beside a demo or a working card and brings its video above the panel.
 * The view supplies its card page, so it needs no video selector or scroll fix of its own.
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
  page = false,
  children,
}: {
  title: string;
  
  head?: React.ReactNode;
  label: string;
  banner: React.ReactNode;
  half?: boolean;
  onClose: () => void;
  
  leave: React.RefObject<(() => void) | null>;
  
  onLeave: () => void;
  
  focus?: React.RefObject<boolean>;
  
  page?: boolean;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  
  
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => setHeight(null), [half]);
  const [leaving, setLeaving] = useState(false);
  
  const drag = useRef<{ y: number; top: number; px: number; trail: Mark[] } | null>(null);
  
  const [gliding, setGliding] = useState<{ ms: number; ease: string } | null>(null);
  const glided = useRef<ReturnType<typeof setTimeout>>(undefined);
  
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
  
  
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const root = document.documentElement;
    let field: Element | null = null;
    
    const measure = () => field && root.style.setProperty('--ph-field', `${Math.max(0, root.clientHeight - field.getBoundingClientRect().top)}px`);
    const size = new ResizeObserver(measure);
    size.observe(el);
    
    el.addEventListener('animationend', measure);
    addEventListener('resize', measure);
    visualViewport?.addEventListener('resize', measure);
    
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
    
    const y = cancelled ? drag.current.trail[drag.current.trail.length - 1]!.y : e.clientY;
    const moved = Math.abs(y - drag.current.y) > 4;
    const px = drag.current.px;
    
    const at = Math.max(0, topAt(y));
    const v = cancelled ? 0 : speed(drag.current.trail, e.timeStamp);
    const to = settle(thrown(at, v, px));
    drag.current = null;
    setDragging(false);
    
    if (!moved) return;
    let ms: number | undefined;
    if (Math.abs(v) >= THROWN) {
      
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
        page && 'page',
        (half || (height ?? 1) < 1) && 'border-t border-border',
        (height ?? 1) < 1 && 'part',
        leaving && 'leaving [transform:translateY(100%)]',
        dragging ? 'dragging transition-none' : '[transition:transform_.2s_ease-out,top_.2s_ease-out,height_.2s_ease-out]',
      )}
      ref={panel}
      style={style as React.CSSProperties}
      role="dialog"
      aria-label={label}
    >
      {page ? (
        <header className={cn(barClass, 'ph-grip py-1.5 ph-landscape:py-1')}>{head ?? <span className={gripWordClass}>{title}</span>}</header>
      ) : (
        <header className={gripClass} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {head ?? <span className={gripWordClass}>{title}</span>}
        </header>
      )}
      {banner}
      {children}
    </div>
  );
}
