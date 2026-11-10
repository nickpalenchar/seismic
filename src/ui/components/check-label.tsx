// The label of a `Switch`, a `Checkbox` or a radio: the control and its text in a row, a click on the
// text acting on the control. Spacing around it is the container's.

import type { ComponentProps } from 'react';

export function CheckLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label className={className ? `check-label ${className}` : 'check-label'} {...props} />;
}
