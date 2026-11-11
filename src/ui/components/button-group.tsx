// ButtonGroup (shadcn/ui): buttons joined into one control, their inner corners squared and no gap between.

import { cn } from 'cn';
import type { ComponentProps } from 'react';

export function ButtonGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn('inline-flex items-stretch [&>[data-slot=button]]:rounded-none [&>[data-slot=button]:first-child]:rounded-l-lg [&>[data-slot=button]:last-child]:rounded-r-lg', className)}
      {...props}
    />
  );
}
