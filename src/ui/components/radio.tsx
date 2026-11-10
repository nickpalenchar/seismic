// Radio groups on Radix RadioGroup: one tab stop for the group, arrow keys move the choice.
// `RadioGroup` is the group, `RadioOption` a round radio with its label (a click on the text
// chooses it), `Radio` the bare item for a choice that draws itself (the canvas icons, the stars).

import { RadioGroup as Group } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { CheckLabel } from './check-label';

const classes = (base: string, className?: string) => (className ? `${base} ${className}` : base);

export function RadioGroup({ label, labelledBy, className, ...props }: Omit<ComponentProps<typeof Group.Root>, 'aria-label' | 'aria-labelledby'> & { label?: string; labelledBy?: string }) {
  return <Group.Root aria-label={label} aria-labelledby={labelledBy} className={className} {...props} />;
}

/** The bare item: its look is the caller's `className`, `data-state=checked` marks the chosen one. */
export const Radio = Group.Item;

/** A radio with its text beside it. */
export function RadioOption({ value, children, className, disabled }: { value: string; children: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <CheckLabel className={classes('radio-option', className)} data-disabled={disabled || undefined}>
      <Group.Item value={value} disabled={disabled} className="radio">
        <Group.Indicator className="radio-dot" />
      </Group.Item>
      {children}
    </CheckLabel>
  );
}
