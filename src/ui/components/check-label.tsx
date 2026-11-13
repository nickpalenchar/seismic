// The label of a `Switch`, a `Checkbox` or a radio: the control and its text in a row, a click on the
// text acting on the control. Spacing around it is the container's, which reaches it as
// `[data-slot=check-label]`. On a touch screen the row is at least a finger tall, so a tap just
// above or below the control or its text still lands on it.

import { cn } from 'cn';
import type { ComponentProps } from 'react';

export function CheckLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="check-label" className={cn('flex cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:gap-2.5', className)} {...props} />;
}
