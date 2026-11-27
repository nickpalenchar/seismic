




import { cn } from 'cn';
import type { ComponentProps } from 'react';

export function CheckLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="check-label" className={cn('flex cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:gap-2.5', className)} {...props} />;
}
