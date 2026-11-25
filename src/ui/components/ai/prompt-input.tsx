







import { cn } from 'cn';
import type { ComponentProps, Ref } from 'react';
import { Button, type ButtonProps, IconButton } from '../button';

export function PromptInput({ className, dropping, ...props }: ComponentProps<'div'> & { dropping?: boolean }) {
  return (
    <div
      data-slot="prompt-input"
      data-dropping={dropping || undefined}
      className={cn('composer group/pi relative mt-4 flex max-w-[80ch] phone:max-w-none phone:shrink-0 flex-wrap items-end gap-x-2.5 gap-y-2', className)}
      {...props}
    />
  );
}

/**
 * The frame: one edge round the text and the buttons, which light up as the field is typed in, dropped
 * on (a dashed edge) and dictated into (the working blue).
 */
export function PromptInputBody({ className, dictating, ...props }: ComponentProps<'div'> & { dictating?: boolean }) {
  return (
    <div
      data-slot="prompt-input-body"
      data-dictating={dictating || undefined}
      className={cn(
        'flex min-w-0 flex-[1_1_100%] flex-col gap-1 rounded-xl border border-border bg-card p-2 shadow-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        'group-data-[dropping]/pi:border-dashed group-data-[dropping]/pi:border-working group-data-[dropping]/pi:bg-working/6',
        'data-[dictating]:border-working data-[dictating]:shadow-[0_0_0_1px_var(--working)] data-[dictating]:focus-within:border-working',
        className,
      )}
      {...props}
    />
  );
}

/** The text: as high as it is written (`fitHeight`), up to a part of the window, then it scrolls. */
export function PromptInputTextarea({ className, ref, ...props }: ComponentProps<'textarea'> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      data-slot="prompt-input-textarea"
      ref={ref}
      rows={1}
      className={cn('min-h-0 max-h-[30vh] min-w-0 w-full box-border resize-none bg-transparent px-1 py-1.5 text-base leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground/80', className)}
      {...props}
    />
  );
}

/** The footer: attachment and microphone at the left, Send at the right. */
export function PromptInputTools({ className, ref, ...props }: ComponentProps<'div'> & { ref?: Ref<HTMLDivElement> }) {
  return <div data-slot="prompt-input-tools" ref={ref} className={cn('flex w-full flex-none items-center gap-1', className)} {...props} />;
}

/** A button of the tools that is not Send: the icon alone, the cursor stays in the field. */
export function PromptInputButton({ className, active, onMouseDown, ...props }: ComponentProps<typeof IconButton> & { active?: boolean }) {
  return (
    <IconButton
      data-slot="prompt-input-button"
      data-active={active || undefined}
      variant="ghost"
      
      className={cn('size-6.5 rounded-lg text-muted-foreground [-webkit-touch-callout:none] select-none touch-none hover:not-disabled:text-foreground data-[active]:bg-working data-[active]:text-primary-foreground data-[active]:hover:not-disabled:bg-working data-[active]:hover:not-disabled:text-primary-foreground', className)}
      {...props}
      onMouseDown={(e) => {
        
        e.preventDefault();
        onMouseDown?.(e);
      }}
    />
  );
}

/** Send: an arrow, as in chat apps, or `action` words for a button that starts something rather than sends. */
export function PromptInputSubmit({ className, arrow, ...props }: ButtonProps & { arrow?: boolean }) {
  return (
    <Button
      data-slot="prompt-input-submit"
      variant="primary"
      className={cn(arrow ? 'size-7.5 rounded-full p-0' : 'rounded-full px-3 py-1.5 text-sm', className)}
      {...props}
    />
  );
}

/** The line under the frame: what is heard, what the words go to, a hint. */
export function PromptInputHint({ className, tone, ...props }: ComponentProps<'div'> & { tone?: 'working' | 'warn' }) {
  return (
    <div
      data-slot="prompt-input-hint"
      className={cn('-mt-1 basis-full text-xs text-muted-foreground', tone === 'working' && 'text-working [&_b]:text-working', tone === 'warn' && 'text-warning', className)}
      {...props}
    />
  );
}
