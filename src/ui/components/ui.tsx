// The component library of the UI: one file per family, each wrapping a Radix Primitive (the single
// `radix-ui` package: one version for every part, so the parts never disagree on shared internals)
// or, where no behaviour is needed, plain markup. Conventions every component here follows:
//
// - API: modelled on shadcn/ui's (its source is the reference; its Tailwind classes are not used).
//   Small composable parts (`Menu`, `MenuTrigger`, `MenuItem` …), a `variant` and `size` prop where
//   the family has variants, `className` passed through for layout only, `asChild` where a link or
//   label must be the element. Text comes from `strings.ts`, never literal.
// - CSS: one block of its own per component, in `components/<name>.css`, imported by `styles.css`
//   (`frost.css` reshapes the shared classes on top, as it does today). The class is the component's
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
import type { ReactNode } from 'react';

/** The id of the element portals go into, inside the app root. */
const PORTAL_ID = 'ui-portal';

/** The element a Radix `Portal` renders into (`<Portal container={uiPortal()}>`); `null` before the root mounted. */
export const uiPortal = (): HTMLElement | null => document.getElementById(PORTAL_ID);

/**
 * Whether a Radix layer (menu, popover, dialog, tooltip, select) is open: it takes Esc before
 * anything under it, so App's handler leaves the key to it.
 */
export const layerOpen = (): boolean =>
  !!document.querySelector(
    `#${PORTAL_ID} [data-state=open], [data-radix-popper-content-wrapper], [role=dialog][data-state=open], [role=alertdialog][data-state=open]`,
  );

/** The app and the portal container beside it, both inside the root element. */
export function UiRoot({ children }: { children: ReactNode }) {
  return (
    <>
      <VisuallyHidden.Root asChild>
        <h1>Seismic</h1>
      </VisuallyHidden.Root>
      {children}
      <div id={PORTAL_ID} />
    </>
  );
}
