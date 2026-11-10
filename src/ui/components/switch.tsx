// A single on/off setting: a sliding switch (Radix Switch). Put it in a `CheckLabel` with its text so
// a click on the text flips it too. Its look is `switch.css`.

import { Switch as RadixSwitch } from 'radix-ui';
import type { ComponentProps } from 'react';

export function Switch({ className, ...props }: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root className={className ? `switch ${className}` : 'switch'} {...props}>
      <RadixSwitch.Thumb className="switch-thumb" />
    </RadixSwitch.Root>
  );
}
