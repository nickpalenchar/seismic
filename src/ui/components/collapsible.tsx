// Collapsible: a fold with a trigger and a region (shadcn/ui's, ours from then on), in place of a native
// `<details>`. The trigger is a button with `aria-expanded` and `aria-controls`; the region leaves the
// page while closed. `marker` puts the disclosure triangle (▸ closed, ▾ open) before the trigger's
// text, as the finding folds and the pull request threads show it. Spacing belongs to the container,
// which reaches the parts through their `data-slot`.

import { cn } from 'cn';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ className, marker, ...props }: ComponentProps<typeof CollapsiblePrimitive.Trigger> & { marker?: boolean }) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        'cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        marker && 'flex min-w-0 items-baseline gap-1.5 py-0.5 before:flex-none before:text-[11px] before:text-muted-foreground before:content-["▸"] data-[state=open]:before:content-["▾"]',
        className,
      )}
      {...props}
    />
  );
}

function CollapsibleContent(props: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props} />;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
