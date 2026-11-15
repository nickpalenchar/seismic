// Radio groups (shadcn/ui's RadioGroup, on Radix RadioGroup): one tab stop for the group, arrow keys
// move the choice. `RadioGroup` is the group, `RadioOption` a round radio with its label (a click on
// the text chooses it), `RadioGroupItem` the round radio alone, `Radio` the bare item for a choice
// that draws itself (the canvas icons, the stars).

import { cn } from 'cn';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { CheckLabel } from './check-label';

export function RadioGroup({ label, labelledBy, ...props }: Omit<ComponentProps<typeof RadioGroupPrimitive.Root>, 'aria-label' | 'aria-labelledby'> & { label?: string; labelledBy?: string }) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" aria-label={label} aria-labelledby={labelledBy} {...props} />;
}

/** The bare item: its look is the caller's `className`, `data-state=checked` marks the chosen one. */
export const Radio = RadioGroupPrimitive.Item;

export function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'inline-grid size-3.5 shrink-0 cursor-[inherit] place-items-center rounded-full border-[1.5px] border-muted-foreground bg-card m-0 p-0 outline-none data-[state=checked]:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" className="size-1.5 rounded-full bg-foreground" />
    </RadioGroupPrimitive.Item>
  );
}

/** A radio with its text beside it. */
export function RadioOption({ value, children, className, disabled }: { value: string; children: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <CheckLabel className={cn('data-disabled:cursor-default data-disabled:opacity-45', className)} data-disabled={disabled || undefined}>
      <RadioGroupItem value={value} disabled={disabled} />
      {children}
    </CheckLabel>
  );
}
