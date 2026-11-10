// One of several options that may be picked together (Radix Checkbox); a single on/off setting is a
// `Switch`. Put it in a `CheckLabel` with its text. Its look is `checkbox.css`.

import { Check } from 'lucide-react';
import { Checkbox as RadixCheckbox } from 'radix-ui';
import type { ComponentProps } from 'react';

export function Checkbox({ className, ...props }: ComponentProps<typeof RadixCheckbox.Root>) {
  return (
    <RadixCheckbox.Root className={className ? `checkbox ${className}` : 'checkbox'} {...props}>
      <RadixCheckbox.Indicator className="checkbox-indicator">
        <Check size={12} strokeWidth={3} aria-hidden />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
