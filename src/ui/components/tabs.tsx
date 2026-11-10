// Tabs on Radix Tabs: a row (or, vertical, a column) of triggers where one is on, and the arrow keys
// move between them. `Tabs` holds the value, `TabsList` the triggers, `TabsContent` a panel. The look
// is the list's `variant` (`segmented`, `underline`, `pill`), or none for a list whose
// triggers the container styles (the canvas strip, the diff change list, the Configuration and Preferences navs). A panel whose state must
// survive being hidden (unsent input) takes `forceMount` and `hidden` itself.

import { Tabs as T } from 'radix-ui';
import type { ComponentProps } from 'react';

const classes = (base: string, className?: string) => (className ? `${base} ${className}` : base);

export function Tabs({ className, ...props }: ComponentProps<typeof T.Root>) {
  return <T.Root className={classes('tabs', className)} {...props} />;
}

export type TabsVariant = 'segmented' | 'underline' | 'pill';

export function TabsList({ variant, className, ...props }: ComponentProps<typeof T.List> & { variant?: TabsVariant }) {
  return <T.List className={classes('tabs-list', className)} data-variant={variant} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return <T.Trigger className={classes('tabs-trigger', className)} {...props} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof T.Content>) {
  return <T.Content className={className} {...props} />;
}
