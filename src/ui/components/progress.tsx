



import { cn } from 'cn';
import { Progress as ProgressPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

function Progress({ className, indicatorClassName, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  const shown = Math.min(100, Math.max(0, value ?? 0));
  return (
    <ProgressPrimitive.Root
      asChild
      data-slot="progress"
      value={shown}
      className={cn('relative block h-1 w-full overflow-hidden rounded-sm bg-muted', className)}
      {...props}
    >
      <span>
        <ProgressPrimitive.Indicator
          asChild
          data-slot="progress-indicator"
          className={cn('block h-full bg-primary transition-[width] duration-300', indicatorClassName)}
          style={{ width: `${shown}%` }}
        >
          <span />
        </ProgressPrimitive.Indicator>
      </span>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
