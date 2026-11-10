// Segmented control and toggle groups (shadcn/ui's ToggleGroup, on Radix ToggleGroup).
// `SegmentedControl` is the pick-one row (theme, landing, Unread | All): the group is one tab stop
// and the arrow keys move between its options. `ToggleGroup` and `ToggleGroupItem` are the parts
// under it: with `variant="segmented"` they wear its look, without one the caller's (the stage chips,
// a multi-select); `type="multiple"` makes each item its own on/off. Where a control sits is up to
// the container, which reaches it as `[data-slot=toggle-group]`.

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { type ComponentProps, createContext, type ReactNode, useContext } from 'react';

const groupVariants = cva('', {
  variants: {
    variant: { none: '', segmented: 'inline-flex gap-0.5 rounded-[3px] bg-chip p-[3px]' },
    size: { default: '', small: '' },
  },
  compoundVariants: [{ variant: 'segmented', size: 'small', className: 'p-0.5' }],
  defaultVariants: { variant: 'none', size: 'default' },
});

const itemVariants = cva('', {
  variants: {
    variant: {
      none: '',
      segmented:
        'cursor-pointer rounded-[2px] border-0 bg-transparent px-3 py-1 text-[13px] text-muted-foreground outline-none data-[state=on]:bg-card data-[state=on]:text-ink data-[state=on]:shadow-glass focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-45',
    },
    size: { default: '', small: '' },
  },
  compoundVariants: [{ variant: 'segmented', size: 'small', className: 'px-2.5 py-[3px] text-[12.5px]' }],
  defaultVariants: { variant: 'none', size: 'default' },
});

type Look = VariantProps<typeof groupVariants>;
const GroupLook = createContext<Look>({});

export function ToggleGroup({ variant, size, className, children, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root> & Look) {
  return (
    <ToggleGroupPrimitive.Root data-slot="toggle-group" data-variant={variant ?? undefined} data-size={size ?? undefined} className={cn(groupVariants({ variant, size }), className)} {...props}>
      <GroupLook.Provider value={{ variant, size }}>{children}</GroupLook.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  const look = useContext(GroupLook);
  return <ToggleGroupPrimitive.Item data-slot="toggle-group-item" className={cn(itemVariants(look), className)} {...props} />;
}

export type SegmentOption<V extends string> = {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
};

/** One of several, always one on: a click on the one that is on changes nothing. */
export function SegmentedControl<V extends string>({
  value,
  onValueChange,
  options,
  label,
  size = 'default',
  disabled,
  className,
  itemClassName,
}: {
  value: V;
  onValueChange: (v: V) => void;
  options: readonly SegmentOption<V>[];
  /** Names the group for screen readers. */
  label: string;
  size?: 'default' | 'small';
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      size={size}
      className={className}
      aria-label={label}
      value={value}
      disabled={disabled}
      // Radix reports '' when the pressed one is pressed again
      onValueChange={(v) => v && onValueChange(v as V)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={o.className ?? itemClassName} disabled={o.disabled} title={o.title}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
