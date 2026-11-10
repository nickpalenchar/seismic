// Tooltip: the short text a control shows on hover or keyboard focus. One `TooltipProvider` (in
// `UiRoot`) gives them all the same delay, and moving from one to the next shows it at once. Radix
// opens a tooltip on pointer movement of a mouse or pen, never of a finger, and on keyboard focus, so a
// tap goes straight to the control. `IconButton` shows its label through it. A disabled control keeps its tooltip: the pointer events Radix listens to still reach it (unlike the click).

import { Tooltip as Primitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { uiPortal } from './ui';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <Primitive.Provider delayDuration={450} skipDelayDuration={250}>
    {children}
  </Primitive.Provider>
);

export type TooltipProps = {
  /** The text it shows. Anything with links or buttons in it is a popover's job, not a tooltip's. */
  content: ReactNode;
  /** The element it describes; it must take a ref and props, as a `<button>` does. */
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
} & Pick<ComponentProps<typeof Primitive.Root>, 'open' | 'onOpenChange' | 'delayDuration'>;

export function Tooltip({ content, children, side = 'top', align = 'center', ...root }: TooltipProps) {
  if (!content) return <>{children}</>;
  return (
    <Primitive.Root disableHoverableContent {...root}>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal container={uiPortal()}>
        <Primitive.Content className="tooltip" side={side} align={align} sideOffset={6} collisionPadding={8}>
          {content}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
