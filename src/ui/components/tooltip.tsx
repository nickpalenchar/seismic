// Tooltip (shadcn/ui's Tooltip, on Radix Tooltip): the short text a control shows on hover or keyboard
// focus. One `TooltipProvider` (in `UiRoot`) gives them all the same delay, and moving from one to the
// next shows it at once. Radix opens a tooltip on pointer movement of a mouse or pen, never of a
// finger, and on keyboard focus, so a tap goes straight to the control. `IconButton` shows its label
// through it. A disabled control keeps its tooltip: the pointer events Radix listens to still reach it
// (unlike the click).

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { uiPortal } from './ui';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={450} skipDelayDuration={250}>
    {children}
  </TooltipPrimitive.Provider>
);

export type TooltipProps = {
  /** The text it shows. Anything with links or buttons in it is a popover's job, not a tooltip's. */
  content: ReactNode;
  /** The element it describes; it must take a ref and props, as a `<button>` does. */
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
} & Pick<ComponentProps<typeof TooltipPrimitive.Root>, 'open' | 'onOpenChange' | 'delayDuration'>;

export function Tooltip({ content, children, side = 'top', align = 'center', ...root }: TooltipProps) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root disableHoverableContent {...root}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={uiPortal()}>
        <TooltipPrimitive.Content
          data-slot="tooltip-content"
          className="pointer-events-none z-60 max-w-[340px] rounded-[3px] bg-surface px-2.5 py-1.5 text-left text-[13px] leading-[1.45] font-normal whitespace-normal text-foreground shadow-lift"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
