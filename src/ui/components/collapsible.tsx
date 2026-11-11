// Collapsible: a fold with a trigger and a region (shadcn/ui's, ours from then on), in place of a native
// `<details>`. The trigger is a button with `aria-expanded` and `aria-controls`; the region leaves the
// page while closed. `marker` puts the disclosure chevron (lucide ChevronRight closed, turned down open) before the trigger's
// text, as the finding folds and the pull request threads show it; without it the children pass through
// untouched, so `asChild` still gets the single element Radix's Slot needs. Spacing belongs to the container,
// which reaches the parts through their `data-slot`.

import { cn } from 'cn';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';

function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ className, marker, children, ...props }: ComponentProps<typeof CollapsiblePrimitive.Trigger> & { marker?: boolean }) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        'cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        marker && 'group/marker flex min-w-0 items-baseline gap-1.5 py-0.5',
        className,
      )}
      {...props}
    >
      {marker ? (
        <>
          <ChevronRight aria-hidden className="size-3 flex-none translate-y-0.5 self-start text-muted-foreground transition-transform group-data-[state=open]/marker:rotate-90" />
          {children}
        </>
      ) : (
        children
      )}
    </CollapsiblePrimitive.Trigger>
  );
}

function CollapsibleContent(props: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props} />;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
