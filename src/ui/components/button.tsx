// Buttons: `Button` for anything with a text label (in its variants, `link` among them, which
// `LinkButton` names), `IconButton` for an icon alone with the label it needs for screen readers and
// a tooltip, and `CloseButton`, the ✕ of every dialog, panel, chip and thumbnail. No Radix part behind
// them: `asChild` uses Radix's `Slot` so a `<summary>` or a link can be the element. Their look is
// `button.css`; where they sit (margins, alignment, a corner) is up to the container.

import { X } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { Tooltip } from './tooltip';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'code-review' | 'review-warning' | 'link';

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

const classes = (base: string, className?: string) => (className ? `${base} ${className}` : base);

export function Button({ variant = 'default', size = 'default', suggested, armed, asChild, className, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={classes('button', className)}
      data-variant={variant}
      data-size={size}
      data-suggested={suggested || undefined}
      data-armed={armed || undefined}
      {...props}
    />
  );
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
      <button
        type="button"
        className={classes('icon-button', className)}
        data-variant={variant}
        data-size={size}
        aria-label={label}
        {...props}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/** The ✕ that closes a dialog or panel, clears a field or removes a chip, a file or a thumbnail. */
export function CloseButton({ size = 'default', variant = size === 'small' ? 'ghost' : 'default', ...props }: Omit<IconButtonProps, 'icon'>) {
  return <IconButton icon={<X size={size === 'small' ? 13 : 17} aria-hidden />} size={size} variant={variant} {...props} />;
}
