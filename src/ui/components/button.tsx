// Buttons (shadcn/ui's Button, ours from then on): `Button` for anything with a text label (in its
// variants, `link` among them, which `LinkButton` names), `IconButton` for an icon alone with the
// label it needs for screen readers and a tooltip, and `CloseButton`, the ✕ of every dialog, panel,
// chip and thumbnail; the last two are compositions of `Button` and `Tooltip`. `asChild` uses Radix's
// `Slot` so a `<summary>` or a link can be the element. A container that sets the button on a surface
// of the chip's tint gives it its own fill through `--button-bg`; where it sits (margins, alignment, a
// corner) is the container's, which reaches it as `[data-slot=button]`.

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { X } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { Tooltip } from './tooltip';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 border-0 text-center whitespace-nowrap cursor-pointer outline-none hover:not-disabled:brightness-105 disabled:cursor-default disabled:opacity-45 focus-visible:ring-[3px] focus-visible:ring-ring/50',
  {
    variants: {
      variant: {
        default: 'bg-[var(--button-bg,var(--muted))] text-foreground',
        primary: 'bg-primary text-primary-foreground',
        danger: 'bg-[var(--button-bg,var(--muted))] text-destructive',
        /** starting a code review: second to Approve, in purple */
        'code-review': 'bg-proposal text-proposal-foreground',
        /** confirming a wontfix: closing the card without a change, in green */
        success: 'bg-approved text-approved-foreground',
        'review-warning': 'bg-amber-300 text-amber-950 shadow-[inset_0_0_0_1px_var(--color-amber-600)]',
        /** the icon alone until hovered */
        ghost: 'bg-transparent text-muted-foreground hover:not-disabled:bg-muted hover:not-disabled:text-foreground hover:not-disabled:brightness-100',
        /** blue and underlined, inline in text */
        link: 'inline rounded-none bg-transparent p-0 leading-[1.25] text-primary whitespace-normal [text-align:inherit] underline decoration-1 underline-offset-[.18em] hover:not-disabled:decoration-2 hover:not-disabled:brightness-100',
      },
      /** `small`: a little apart from the text it stands under */
      size: { default: '', small: '[:is(p,ul,ol,.c-install)+&]:mt-2', icon: 'size-8 shrink-0 rounded-lg p-0', 'icon-small': 'size-5 shrink-0 rounded-[3px] p-0' },
      /** a ring around it: the step the agent suggests */
      suggested: { true: 'shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--idea)]' },
      /** disabled while it waits, yet not faded, with a bar running under its label */
      armed: {
        true: "relative overflow-hidden disabled:opacity-100 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-[linear-gradient(90deg,transparent,var(--idea),transparent)] after:bg-[length:200%_100%] after:animate-[flow_1.4s_linear_infinite] after:content-['']",
      },
    },
    compoundVariants: [
      // a link takes the weight of the text it stands in; `small` only makes it smaller
      { variant: ['default', 'primary', 'danger', 'code-review', 'review-warning', 'success', 'ghost'], size: 'default', className: 'rounded-lg px-[13px] py-[7px] font-semibold leading-[1.25]' },
      { variant: ['default', 'primary', 'danger', 'code-review', 'review-warning', 'success', 'ghost'], size: 'small', className: 'rounded-lg px-[11px] py-[5px] text-[12.5px] font-medium leading-[1.25]' },
      { variant: 'link', size: 'small', className: 'text-[12.5px]' },
    ],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;

export type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: 'default' | 'small';
  /** A ring around it: the step the agent suggests. */
  suggested?: boolean;
  /** Clicked while an agent works on the card: held, with a bar running under the label until it is done. */
  armed?: boolean;
  /** Render the one child (a `<summary>`, a link) as the button instead of a `<button>`. */
  asChild?: boolean;
};

function Base({
  variant = 'default',
  size = 'default',
  suggested,
  armed,
  asChild,
  className,
  ...props
}: Omit<ButtonProps, 'size'> & { size?: VariantProps<typeof buttonVariants>['size'] }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-suggested={suggested || undefined}
      data-armed={armed || undefined}
      className={cn(buttonVariants({ variant, size, suggested: !!suggested, armed: !!armed }), className)}
      {...props}
    />
  );
}

export function Button(props: ButtonProps) {
  return <Base {...props} />;
}

/** A button that reads as a link: blue and underlined, inline in text. */
export function LinkButton(props: Omit<ButtonProps, 'variant' | 'size'>) {
  return <Button variant="link" {...props} />;
}

export type IconButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  icon: ReactNode;
  /** What it does, for screen readers and as its tooltip. */
  label: string;
  /** `default` sits on a chip; `ghost` is the icon alone until hovered; `danger` is a ghost that turns red (a delete). */
  variant?: 'default' | 'ghost' | 'danger';
  size?: 'default' | 'small';
};

export function IconButton({ icon, label, variant = 'default', size = 'default', className, ...props }: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <Base
        type="button"
        variant={variant === 'default' ? 'default' : 'ghost'}
        size={size === 'small' ? 'icon-small' : 'icon'}
        className={cn(variant === 'danger' && 'hover:not-disabled:text-destructive', className)}
        aria-label={label}
        {...props}
      >
        {icon}
      </Base>
    </Tooltip>
  );
}

/** The ✕ that closes a dialog or panel, clears a field or removes a chip, a file or a thumbnail. */
export function CloseButton({ size = 'default', variant = size === 'small' ? 'ghost' : 'default', ...props }: Omit<IconButtonProps, 'icon'>) {
  return <IconButton icon={<X size={size === 'small' ? 13 : 17} aria-hidden />} size={size} variant={variant} {...props} />;
}

export { buttonVariants };
