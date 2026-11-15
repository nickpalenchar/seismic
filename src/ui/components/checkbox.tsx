// One of several options that may be picked together (shadcn/ui's Checkbox, on Radix Checkbox); a
// single on/off setting is a `Switch`. Put it in a `CheckLabel` with its text.

import { cn } from 'cn';
import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm border border-foreground/40 bg-card m-0 p-0 text-primary-foreground outline-none data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-items-center">
        <Check size={12} strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
