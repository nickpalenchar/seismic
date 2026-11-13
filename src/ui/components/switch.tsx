// A single on/off setting: a sliding switch (shadcn/ui's Switch, on Radix Switch). Put it in a
// `CheckLabel` with its text so a click on the text flips it too. On a touch screen it is larger,
// sized for a finger rather than a mouse pointer.

import { cn } from 'cn';
import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative h-[18px] w-8 pointer-coarse:h-6 pointer-coarse:w-11 shrink-0 cursor-pointer rounded-full border-0 m-0 p-0 outline-none transition-colors bg-foreground/25 data-[state=checked]:bg-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3.5 rounded-full bg-white shadow-[0_1px_2px_--alpha(black/30%)] transition-transform translate-x-0.5 data-[state=checked]:translate-x-4 pointer-coarse:size-5 pointer-coarse:data-[state=checked]:translate-x-[22px]"
      />
    </SwitchPrimitive.Root>
  );
}
