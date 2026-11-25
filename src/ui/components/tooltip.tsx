






import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { uiPortal } from './ui';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={450} skipDelayDuration={250}>
    {children}
  </TooltipPrimitive.Provider>
);

export type TooltipProps = {
  
  content: ReactNode;
  
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
          className="pointer-events-none z-60 max-w-85 rounded-sm bg-surface px-2.5 py-1.5 text-left text-sm leading-[1.45] font-normal whitespace-normal text-foreground shadow-lift"
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
