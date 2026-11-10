// Input and Textarea: the one look of a text field (shadcn/ui's, ours from then on). A field sunk a
// little into its surface, a shade darker with a firmer edge, which comes up to the surface's own colour
// while it is typed in. No container styles a field's look; layout (width, flex) belongs to the container,
// which reaches a field through `[data-slot=input]`. `bare` is the field that is part of something else
// (a title, a written answer, a search box with its own icon): no fill, edge or padding, the container
// sets its size and type.

import { cn } from 'cn';
import type { ComponentProps } from 'react';

export const inputFieldClassName =
  'rounded-lg border border-[color-mix(in_srgb,var(--ink)_16%,var(--panel))] bg-[color-mix(in_srgb,var(--ink)_5%,var(--panel))] px-[9px] py-1.5 text-[13px] text-ink shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_7%,transparent)] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground/80 hover:border-[color-mix(in_srgb,var(--ink)_28%,var(--panel))] focus:border-muted-foreground focus:bg-panel disabled:opacity-55 aria-invalid:border-destructive';
export const field = inputFieldClassName;
const bare = 'rounded-none border-0 bg-transparent p-0 shadow-none hover:border-0 focus:bg-transparent';

function Input({ className, type = 'text', bare: isBare, ...props }: ComponentProps<'input'> & { bare?: boolean }) {
  return <input type={type} data-slot="input" className={cn(inputFieldClassName, isBare && bare, className)} {...props} />;
}

/** `mono` for code and settings lines. */
function Textarea({ className, mono, bare: isBare, ...props }: ComponentProps<'textarea'> & { mono?: boolean; bare?: boolean }) {
  return <textarea data-slot="textarea" className={cn(inputFieldClassName, 'resize-y', mono && 'font-mono text-xs', isBare && bare, className)} {...props} />;
}

export { Input, Textarea };
