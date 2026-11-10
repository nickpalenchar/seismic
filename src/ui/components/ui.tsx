// The component library of the UI: one file per family, each wrapping a Radix Primitive (the single
// `radix-ui` package: one version for every part, so the parts never disagree on shared internals)
// or, where no behaviour is needed, plain markup. Conventions every component here follows:
//
// - API: modelled on shadcn/ui's (its source is the reference; its Tailwind classes are not used).
//   Small composable parts (`Menu`, `MenuTrigger`, `MenuItem` …), a `variant` and `size` prop where
//   the family has variants, `className` passed through for layout only, `asChild` where a link or
//   label must be the element. Text comes from `strings.ts`, never literal.
// - CSS: one block of its own per component, in `components/<name>.css`, imported by `styles.css`
//   (the component's look and its shape come from the same file). The class is the component's
//   name (`.switch`); layout (gap, alignment, margin) belongs to the container, never to an
//   override such as `.actions .btn`.
// - Tokens: colours, radii and shadows come from the CSS variables of the theme (`--card`, `--ink`,
//   `--chip` …) so light, dark and frost apply without a rule of their own.
// - State: styled by the data attributes Radix sets (`[data-state=open]`, `[data-disabled]`,
//   `[data-highlighted]`) and our own (`data-variant`), not by extra state classes.
// - Layers: anything that opens over the page (menu, popover, dialog, tooltip) portals into
//   `uiPortal()` so the theme applies, and dismisses itself on Esc and outside click; App's Esc
//   handler leaves an open layer alone (see `layerOpen`).

import { VisuallyHidden } from 'radix-ui';
import { type ReactNode, useCallback, useState } from 'react';
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
