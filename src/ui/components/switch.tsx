// A single on/off setting: a sliding switch (shadcn/ui's Switch, on Radix Switch). Put it in a
// `CheckLabel` with its text so a click on the text flips it too.

import { cn } from 'cn';
import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative h-[18px] w-8 shrink-0 cursor-pointer rounded-full border-0 m-0 p-0 outline-none transition-colors bg-[color-mix(in_srgb,var(--ink)_25%,var(--panel))] data-[state=checked]:bg-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-transform translate-x-0.5 data-[state=checked]:translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}
