// A main-area view stays mounted underneath an unfolded card. The canvas camera stays intact.
import { createContext, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from 'cn';

export function useFullPage<Id extends string>(initial: () => Id | null = () => null) {
  const [active, render] = useState<Id | null>(initial);
  const ref = useRef(active);
  return { active, ref, show: (id: Id | null) => { ref.current = id; render(id); } };
}

const MainArea = createContext<HTMLDivElement | null>(null);

/** The project root owns the dock offsets. Portal here so every full-page view inherits them. */
export function FullPageHost({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return <div {...props} ref={setHost}><MainArea.Provider value={host}>{children}</MainArea.Provider></div>;
}

/**
 * A full-page view stays within the main area, below the floating row (z 24), the bar and dock sheets (25)
 * and unfolded cards (dim 30, panel 40); the floating row stands over its top. A column: its head, then its
 * body (`fullHeadClass`, `fullBodyClass`).
 */
const fullPageClass =
  'full-page fixed z-23 top-[50px] pt-12 box-border bottom-0 left-[var(--left,0px)] right-[var(--side,0px)] flex flex-col bg-surface';

/** A full-page view's head: its title, what it has beside it (a search, a count) and its ✕ at the end. */
export const fullHeadClass = 'a-full-head flex items-center gap-3.5 pt-3 px-6 pb-1.5';
/** A full-page view's title in its head. */
export const fullTitleClass = 'mt-0 mx-0 mb-1.5 text-lg';
/** A full-page view's ✕. */
export const fullCloseClass = 'a-full flex-none mb-1.5';
/** A full-page view's body under its head, scrolling; what it lists keeps to a readable width. */
export const fullBodyClass =
  'a-full-body flex-1 overflow-auto pt-1 px-6 pb-6 [&>section]:max-w-[760px] [&>[data-slot=button]]:max-w-[760px] [&>.hint]:max-w-[760px]';

/** A full-page view of the main area; `onClickBeside` is called for a press outside it (on the bar, a sheet), not one in a layer opened over it. `className` changes its layout (the inbox's row). */
export function FullPage({ id, title, onClickBeside, className, children }: { id: string; title: string; onClickBeside?: () => void; className?: string; children: ReactNode }) {
  const host = useContext(MainArea);
  const beside = useRef(onClickBeside);
  beside.current = onClickBeside;
  useEffect(() => {
    if (!onClickBeside) return;
    const down = (e: PointerEvent) => {
      const at = e.target instanceof Element ? e.target : null;
      if (!at?.closest(`#${id}, #ui-portal`)) beside.current?.();
    };
    addEventListener('pointerdown', down, true);
    return () => removeEventListener('pointerdown', down, true);
  }, [!onClickBeside]);
  return host && createPortal(<div id={id} className={cn(fullPageClass, className)} role="dialog" aria-label={title}>{children}</div>, host);
}
