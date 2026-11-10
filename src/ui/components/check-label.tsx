// The label of a `Switch`, a `Checkbox` or a radio: the control and its text in a row, a click on the
// text acting on the control. Spacing around it is the container's, which reaches it as
// `[data-slot=check-label]`.

import { cn } from 'cn';
import type { ComponentProps } from 'react';

export function CheckLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="check-label" className={cn('flex cursor-pointer items-center gap-2 text-[13px]', className)} {...props} />;
}
