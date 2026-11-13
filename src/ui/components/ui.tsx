// The component library of the UI: shadcn/ui's parts (on Radix Primitives, from the single `radix-ui`
// package, so the parts never disagree on shared internals), one file per family, and AI Elements for
// the conversations in `ai/`. Conventions every component here follows:
//
// - Source: added with the shadcn CLI (`bunx --bun shadcn@latest add <part>`, set up by
//   `components.json`), then ours: edited freely, in this repository's style, with frost's needs
//   written into it rather than patched over from outside. Small composable parts (`Menu`,
//   `MenuTrigger`, `MenuItem` …), `variant` and `size` through cva, `className` merged with `cn`,
//   `asChild` where a link or label must be the element. Text comes from `strings.ts`, never literal.
// - Look: Tailwind classes in the component on shadcn's tokens (`bg-primary`, `text-muted-foreground`)
//   and Seismic's own (`bg-waiting`, `bg-glass`), which `tailwind.css` takes from frost, so light,
//   dark and frost apply without a rule of their own. Tailwind's preflight is on, so a bare `button` or
//   `input` needs no reset of its own; layout (gap, alignment, margin) belongs to the container, which
//   reaches a part through its `data-slot` (`[data-slot=button]`), never to change its look.
// - State: styled by the data attributes Radix sets (`data-[state=open]:`, `data-disabled:`,
//   `data-highlighted:`) and our own (`data-variant`), not by extra state classes.
// - Layers: anything that opens over the page (menu, popover, dialog, sheet, tooltip) portals into
//   `uiPortal()` so the theme applies, and dismisses itself on Esc and outside click; App's Esc
//   handler leaves an open layer alone (see `layerOpen`).

import { VisuallyHidden } from 'radix-ui';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { TooltipProvider } from './tooltip';

/** The id of the element portals go into, inside the app root. */
const PORTAL_ID = 'ui-portal';

/**
 * The element a Radix `Portal` renders into (`<Portal container={uiPortal()}>`). `UiRoot` mounts
 * the app only once the element exists, so it is never `null` for anything rendered inside the app
 * (a null container would make Radix fall back to `document.body`, outside the theme).
 */
export const uiPortal = (): HTMLElement | null => document.getElementById(PORTAL_ID);

/**
 * Whether a Radix layer (menu, popover, dialog, tooltip, select) is open: it takes Esc before
 * anything under it, so App's handler leaves the key to it. `$=open` because a tooltip's states are
 * `delayed-open` and `instant-open`, never `open`.
 */
export const layerOpen = (): boolean =>
  !!document.querySelector(
    `#${PORTAL_ID} :is([role=dialog], [role=alertdialog], [role=menu], [role=listbox], [role=tooltip])[data-state$=open], [data-radix-popper-content-wrapper] > [data-state$=open]`,
  );

/**
 * Focus back to whatever opened a modal layer. Radix hands it back only to a `Trigger`; a dialog or
 * sheet opened by a button of its own (`open` set from outside, often from several places) would leave
 * it on the page's body. `onOpenAutoFocus` notes the element with the focus as the layer mounts (still
 * the opener then), `onCloseAutoFocus` returns there while it is still on the page and not inert (a
 * page the layer's choice covered); otherwise Radix's own handling stands. A handler of the caller
 * that prevents the default keeps its say.
 */
export function useOpenerFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const el = document.activeElement;
      opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
    },
    onCloseAutoFocus: (e: Event) => {
      const el = opener.current;
      opener.current = null;
      if (e.defaultPrevented || !el?.isConnected || el.closest('[inert]')) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
    },
  };
}

/** The app and the portal container beside it, both inside the root element; the app mounts once the container exists. */
export function UiRoot({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const markReady = useCallback((el: HTMLDivElement | null) => {
    if (el) setReady(true);
  }, []);
  return (
    <>
      <VisuallyHidden.Root asChild>
        <h1>Seismic</h1>
      </VisuallyHidden.Root>
      {ready && <TooltipProvider>{children}</TooltipProvider>}
      <div id={PORTAL_ID} ref={markReady} />
    </>
  );
}
