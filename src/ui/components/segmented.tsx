// Segmented control and toggle groups on Radix ToggleGroup. `SegmentedControl` is the pick-one row
// (theme, landing, Unread | All): the group is one tab stop and the arrow keys move between its
// options. `ToggleGroup` and `ToggleItem` are the parts under it, for a group that wears another
// look (the stage chips, a multi-select): `type="multiple"` makes each item its own on/off. Their
// look is `segmented.css`; where a control sits is up to the container.

import { ToggleGroup as Group } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

const classes = (base: string, className?: string) => (className ? `${base} ${className}` : base);

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
    <Group.Root
      type="single"
      className={classes('segmented', className)}
      data-size={size}
      aria-label={label}
      value={value}
      disabled={disabled}
      // Radix reports '' when the pressed one is pressed again
      onValueChange={(v) => v && onValueChange(v as V)}
    >
      {options.map((o) => (
        <Group.Item key={o.value} value={o.value} className={classes('segmented-item', o.className ?? itemClassName)} disabled={o.disabled} title={o.title}>
          {o.label}
        </Group.Item>
      ))}
    </Group.Root>
  );
}

export const ToggleGroup = (props: ComponentProps<typeof Group.Root>) => <Group.Root {...props} />;
export const ToggleItem = (props: ComponentProps<typeof Group.Item>) => <Group.Item {...props} />;
