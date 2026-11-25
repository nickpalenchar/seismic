



















import { VisuallyHidden } from 'radix-ui';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { TooltipProvider } from './tooltip';


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
