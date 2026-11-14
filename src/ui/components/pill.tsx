// Pills: the rounded buttons and labels of the bars (the top bar, the floating row under it, the status
// bar) and of the phone's controls over its list. A pill is a small pane of frost's glass; in the status
// bar it is `flat`, the bar's own glass behind it. `PillButton` is one that acts: it lifts under the
// pointer, and `on` marks it while what it opens is showing, as a chip's fill or, with `tone="ink"`
// (the conversation's button), inverted. Where a pill sits is its container's (`[data-slot=pill]`).

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type { ComponentProps } from 'react';

const pillVariants = cva('flex items-center gap-2 rounded-full text-base whitespace-nowrap [&_b]:font-semibold', {
  variants: {
    variant: {
      glass: 'border border-glass-edge bg-card px-3.5 py-1.5 shadow-[inset_0_1px_0_var(--glass-hi),var(--shadow)] backdrop-blur-[12px] backdrop-saturate-[1.4]',
      /** in the status bar, on its glass */
      flat: 'h-7 py-0 text-sm',
    },
    /** one height for every button of a bar, whatever it holds */
    size: { default: '', bar: 'h-8 py-0' },
  },
  defaultVariants: { variant: 'glass', size: 'default' },
});

type PillProps = VariantProps<typeof pillVariants>;

function Pill({ variant, size, className, ...props }: ComponentProps<'div'> & PillProps) {
  return <div data-slot="pill" className={cn(pillVariants({ variant, size }), className)} {...props} />;
}

const onTones = {
  chip: 'data-[on]:bg-muted data-[on]:text-foreground',
  ink: 'data-[on]:bg-foreground data-[on]:text-background',
};

function PillButton({ variant, size, on, tone = 'chip', className, ...props }: ComponentProps<'button'> & PillProps & { on?: boolean; tone?: keyof typeof onTones }) {
  return (
    <button
      data-slot="pill"
      data-on={on || undefined}
      className={cn(pillVariants({ variant, size }), 'cursor-pointer hover:shadow-lift', onTones[tone], className)}
      {...props}
    />
  );
}

export { Pill, PillButton, pillVariants };
