



import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive: 'bg-destructive text-destructive-foreground focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90',
        outline: 'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        
        count: 'rounded-sm px-1.5 py-0 text-xs leading-[inherit] font-bold',
        
        label: 'gap-1 border-border bg-muted px-1.5 py-0 text-sm leading-4 font-medium tracking-[.01em] text-muted-foreground normal-case [&>svg]:size-auto! data-[suggested=true]:border-dashed data-[suggested=true]:border-proposal',
        
        pill: 'max-w-full gap-1.5 overflow-visible border-glass-edge bg-muted py-px pr-2 pl-2 align-baseline text-sm leading-[1.45] font-normal text-working no-underline focus-visible:border-working focus-visible:ring-0 [a&]:hover:border-working [a&]:hover:bg-working/8',
        
        chip: 'h-6 gap-1 bg-muted py-0 pr-1 pl-2.5 text-sm leading-none font-normal',
        
        
        pin: '[&_svg]:block [&_svg]:flex-none [&_svg]:size-3.5 [&>svg]:size-3.5 absolute isolate -top-2.5 -right-2 grid h-6 min-w-6 origin-[70%_30%] scale-[max(1,calc(.9/var(--s)))] place-items-center overflow-visible rounded-xl px-2 text-sm leading-none font-bold text-(--pin-fg) [--pin:var(--waiting)] [--pin-fg:var(--waiting-foreground)] before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:[background:radial-gradient(circle_at_35%_30%,--alpha(white/45%),transparent_45%),var(--pin)] before:shadow-[0_0_0_2px_var(--glass-edge),0_4px_10px_-2px_--alpha(black/25%)] before:content-[\'\']',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);


const countTone = { planned: 'bg-planned text-planned-foreground', waiting: 'bg-waiting text-waiting-foreground', destructive: 'bg-destructive text-destructive-foreground' };

/** `pulse` sends a sonar ring outward from a pin, for what waits for the owner. */
function Badge({ className, variant = 'default', tone = 'planned', asChild = false, pulse, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean; pulse?: boolean; tone?: keyof typeof countTone }) {
  const Comp = asChild ? Slot.Root : 'span';
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), variant === 'count' && countTone[tone], pulse && 'after:pointer-events-none after:absolute after:-inset-0.5 after:-z-20 after:animate-[pulse_1.8s_ease-out_infinite] after:rounded-[inherit] after:border-2 after:border-[var(--pin)] after:opacity-0 after:content-[\'\']', className)} {...props} />;
}

/** The class string of a badge variant for what is not React (the card-link pill the composer builds as DOM); `extra` joins it. */
const badgeClass = (variant: NonNullable<VariantProps<typeof badgeVariants>['variant']>, ...extra: string[]) => cn(badgeVariants({ variant }), ...extra);

export { Badge, badgeClass, badgeVariants };
