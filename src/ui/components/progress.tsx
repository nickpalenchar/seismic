// Progress: how far something is, as a bar (shadcn/ui's, ours from then on). The root is the track and
// carries `role=progressbar` with the value; `indicatorClassName` sets the fill's colour, `className`
// the track's size and tint.

import { cn } from 'cn';
import { Progress as ProgressPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

function Progress({ className, indicatorClassName, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  const shown = Math.min(100, Math.max(0, value ?? 0));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={shown}
      className={cn('relative block h-1 w-full overflow-hidden rounded-sm bg-chip', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('block h-full bg-primary transition-[width] duration-300', indicatorClassName)}
        style={{ width: `${shown}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
