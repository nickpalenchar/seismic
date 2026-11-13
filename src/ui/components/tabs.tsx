// Tabs (shadcn/ui's Tabs, on Radix Tabs): a row (or, vertical, a column) of triggers where one is on,
// and the arrow keys move between them. `Tabs` holds the value, `TabsList` the triggers, `TabsContent`
// a panel. The look is the list's `variant` (`segmented`, `underline`, `pill`), or none for a list
// whose triggers the container styles (the canvas strip, the diff change list, the Configuration and
// Preferences navs). The canvas strip and the change list open a tab only on Enter or a click
// (`activationMode="manual"`), not as the arrow keys pass it. A panel whose state must survive being hidden
// (unsent input) takes `forceMount` and `hidden` itself. A `Tabs` that only holds its list takes
// `className="contents"`, so the list is laid out by the container.

import { cn } from 'cn';
import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function Tabs(props: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

export type TabsVariant = 'segmented' | 'underline' | 'pill';

const lists: Record<TabsVariant, string> = {
  segmented: 'inline-flex gap-0.5 rounded-[3px] bg-muted p-[3px]',
  underline: 'flex flex-wrap gap-x-4 gap-y-1 border-0 border-b border-solid border-border',
  pill: 'flex gap-1.5',
};

export function TabsList({ variant, className, ...props }: ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn('group/tabs-list', variant && lists[variant], className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'group-data-[variant=segmented]/tabs-list:cursor-pointer group-data-[variant=segmented]/tabs-list:rounded-[2px] group-data-[variant=segmented]/tabs-list:border-0 group-data-[variant=segmented]/tabs-list:bg-transparent group-data-[variant=segmented]/tabs-list:px-3 group-data-[variant=segmented]/tabs-list:py-1 group-data-[variant=segmented]/tabs-list:text-[13px] group-data-[variant=segmented]/tabs-list:text-muted-foreground group-data-[variant=segmented]/tabs-list:data-[state=active]:bg-card group-data-[variant=segmented]/tabs-list:data-[state=active]:text-foreground group-data-[variant=segmented]/tabs-list:data-[state=active]:shadow-glass',
        'group-data-[variant=underline]/tabs-list:cursor-pointer group-data-[variant=underline]/tabs-list:border-0 group-data-[variant=underline]/tabs-list:border-b-2 group-data-[variant=underline]/tabs-list:border-solid group-data-[variant=underline]/tabs-list:border-transparent group-data-[variant=underline]/tabs-list:bg-transparent group-data-[variant=underline]/tabs-list:px-0.5 group-data-[variant=underline]/tabs-list:py-2 group-data-[variant=underline]/tabs-list:text-sm group-data-[variant=underline]/tabs-list:text-muted-foreground group-data-[variant=underline]/tabs-list:[overflow-wrap:anywhere] group-data-[variant=underline]/tabs-list:hover:text-foreground group-data-[variant=underline]/tabs-list:data-[state=active]:border-waiting group-data-[variant=underline]/tabs-list:data-[state=active]:font-semibold group-data-[variant=underline]/tabs-list:data-[state=active]:text-foreground',
        'group-data-[variant=pill]/tabs-list:cursor-pointer group-data-[variant=pill]/tabs-list:rounded-[14px] group-data-[variant=pill]/tabs-list:border group-data-[variant=pill]/tabs-list:border-solid group-data-[variant=pill]/tabs-list:border-border group-data-[variant=pill]/tabs-list:bg-transparent group-data-[variant=pill]/tabs-list:px-3.5 group-data-[variant=pill]/tabs-list:py-1 group-data-[variant=pill]/tabs-list:text-[13px] group-data-[variant=pill]/tabs-list:text-muted-foreground group-data-[variant=pill]/tabs-list:data-[state=active]:border-foreground group-data-[variant=pill]/tabs-list:data-[state=active]:bg-foreground group-data-[variant=pill]/tabs-list:data-[state=active]:text-background',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent(props: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" {...props} />;
}
