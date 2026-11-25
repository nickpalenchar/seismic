





import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type { ComponentProps } from 'react';

const pillVariants = cva('flex items-center gap-2 rounded-full text-base whitespace-nowrap [&_b]:font-semibold', {
  variants: {
    variant: {
      glass: 'border border-glass-edge bg-card px-3.5 py-1.5 shadow-[inset_0_1px_0_var(--glass-hi),var(--shadow)] backdrop-blur-[12px] backdrop-saturate-[1.4]',
      
      flat: 'h-7 py-0 text-sm',
    },
    
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
