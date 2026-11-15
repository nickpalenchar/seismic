// Selects (shadcn/ui's Select, on Radix Select): a field that shows the current choice and opens a list
// of options, with arrow keys, typeahead, Esc and an outside click handled by Radix. The list is
// portaled into `uiPortal()` so the theme applies.
//
// `Select` is the whole control: `value` and `onValueChange`, the options as `SelectItem` children
// (`SelectGroup` with a `SelectLabel` for a titled set), `aria-label` for the closed field, `className`
// for its size (width belongs to the container). An option whose value is the empty string (the
// "default" or "all" of a setting) works as in a native select: Radix refuses an empty item value, so
// it is carried as a sentinel.

import { cn } from 'cn';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { inputFieldClassName } from './input';
import { uiPortal } from './ui';

const EMPTY = '\u0000';
const wrap = (v: string) => (v === '' ? EMPTY : v);
const unwrap = (v: string) => (v === EMPTY ? '' : v);

export function Select({
  value,
  onValueChange,
  children,
  disabled,
  className,
  id,
  triggerRef,
  'aria-label': label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  'aria-label'?: string;
}) {
  return (
    <SelectPrimitive.Root data-slot="select" value={wrap(value)} onValueChange={(v) => onValueChange(unwrap(v))} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        ref={triggerRef}
        aria-label={label}
        data-slot="select-trigger"
        className={cn(inputFieldClassName, 'inline-flex min-w-0 max-w-full cursor-pointer items-center justify-between gap-2 py-1.5 pr-2.5 text-left font-[inherit]', className)}
      >
        <span className="min-w-0 truncate">
          <SelectPrimitive.Value />
        </span>
        <SelectPrimitive.Icon asChild>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
            <path d="M2 3.8 5 6.6l3-2.8" />
          </svg>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={uiPortal()}>
        <SelectPrimitive.Content
          data-slot="select-content"
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-80 max-h-[min(var(--radix-select-content-available-height),360px)] min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-glass-edge bg-surface text-sm text-foreground shadow-lift"
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function SelectItem({ value, className, children, ...props }: Omit<ComponentProps<typeof SelectPrimitive.Item>, 'value'> & { value: string }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={wrap(value)}
      className={cn(
        'relative flex cursor-pointer items-center rounded-sm px-2.5 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-foreground/8 data-[state=checked]:font-semibold',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectGroup(props: ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label data-slot="select-label" className={cn('px-2.5 py-1 text-xs text-muted-foreground', className)} {...props} />;
}
