// Tabs on Radix: arrow keys select a tab, or only focus it with activationMode="manual".
// Lists opt into a look; an omitted variant leaves the canvas strip and view navigation to their containers.
// forceMount + hidden keeps a panel's unsent input mounted when another tab is selected.
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { createContext, useContext, type ComponentProps } from 'react';

export function Tabs({ className, orientation = 'horizontal', asChild, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" data-orientation={orientation} orientation={orientation} asChild={asChild} className={cn(!asChild && 'group/tabs flex gap-2 data-[orientation=horizontal]:flex-col', className)} {...props} />;
}

// A minimum keeps stock proportions while growing around larger touch targets or stacked tabs.
const listVariants = cva('', {
  variants: {
    variant: {
      none: '',
      segmented: 'inline-flex min-h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground data-[orientation=vertical]:flex-col',
      underline: 'flex flex-wrap gap-x-4 gap-y-1 border-b border-border',
      pill: 'flex gap-1.5',
    },
  },
});
const triggerVariants = cva('outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50', {
  variants: {
    variant: {
      none: '',
      segmented: "inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-all focus-visible:border-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      underline: 'cursor-pointer border-b-2 border-transparent bg-transparent px-0.5 py-2 text-sm text-muted-foreground [overflow-wrap:anywhere] hover:not-disabled:text-foreground data-[state=active]:border-waiting data-[state=active]:font-semibold data-[state=active]:text-foreground',
      pill: 'cursor-pointer rounded-xl border border-border bg-transparent px-3.5 py-1 text-sm text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-foreground data-[state=active]:text-background',
    },
  },
});
export type TabsVariant = Exclude<NonNullable<VariantProps<typeof listVariants>['variant']>, 'none'>;
const ListVariant = createContext<TabsVariant | 'none'>('none');

export function TabsList({ variant, className, ...props }: ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <ListVariant value={variant ?? 'none'}>
      <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn(listVariants({ variant: variant ?? 'none' }), className)} {...props} />
    </ListVariant>
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = useContext(ListVariant);
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn(triggerVariants({ variant }), className)} {...props} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />;
}
