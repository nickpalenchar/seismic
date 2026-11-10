// AI Elements' Prompt Input, ours from here on: the frame the owner writes in under a conversation,
// the same on every card kind, in the chats and on the phone. `PromptInput` is the block (the frame
// with its text, the line of hints under it, the menu above it); `PromptInputBody` is the frame, which
// the text, the buttons (`PromptInputTools`: attach, microphone, send) and a quoted message stand in.
// What the library's version leaves to the app is the composer's: voice (push-to-talk, dictation),
// screenshots, the skill menu and card links, grafted on in `composer.tsx`. `composer` stays on the
// block as the hook layouts and scripts find the field by; `data-slot` is how containers reach parts.

import { cn } from 'cn';
import type { ComponentProps, Ref } from 'react';
import { Button, type ButtonProps, IconButton } from '../button';

export function PromptInput({ className, dropping, ...props }: ComponentProps<'div'> & { dropping?: boolean }) {
  return (
    <div
      data-slot="prompt-input"
      data-dropping={dropping || undefined}
      className={cn('composer group/pi relative mt-4 flex max-w-[80ch] flex-wrap items-end gap-x-2.5 gap-y-2', className)}
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
        'flex min-w-0 flex-[1_1_100%] flex-wrap items-end gap-1 rounded-[3px] border border-line bg-card p-1 focus-within:border-muted-foreground',
        'group-data-[dropping]/pi:border-dashed group-data-[dropping]/pi:border-working group-data-[dropping]/pi:bg-[color-mix(in_srgb,var(--working)_6%,var(--card))]',
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
      className={cn('min-h-0 max-h-[30vh] min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[14px] leading-[1.45] text-ink outline-none placeholder:text-muted-foreground/80', className)}
      {...props}
    />
  );
}

/**
 * The buttons in the frame's bottom corner, beside the text's scrollbar rather than over it: side by
 * side beside a short text, on top of each other (`stacked`, set by `fitField`) beside a tall one.
 */
export function PromptInputTools({ className, ref, ...props }: ComponentProps<'div'> & { ref?: Ref<HTMLDivElement> }) {
  return <div data-slot="prompt-input-tools" ref={ref} className={cn('flex flex-none items-center gap-0.5 data-[stacked]:flex-col', className)} {...props} />;
}

/** A button of the tools that is not Send: the icon alone, the cursor stays in the field. */
export function PromptInputButton({ className, active, onMouseDown, ...props }: ComponentProps<typeof IconButton> & { active?: boolean }) {
  return (
    <IconButton
      data-slot="prompt-input-button"
      data-active={active || undefined}
      variant="ghost"
      className={cn('size-[26px] rounded-lg text-muted-foreground hover:not-disabled:text-ink data-[active]:bg-working data-[active]:text-on-ink data-[active]:hover:not-disabled:bg-working data-[active]:hover:not-disabled:text-on-ink', className)}
      {...props}
      onMouseDown={(e) => {
        // Keep the keyboard and layout steady until click opens the picker (or another tool).
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
      className={cn(arrow ? 'size-[30px] rounded-[3px] p-0' : 'rounded-[2px] px-3 py-1.5 text-[13px]', className)}
      {...props}
    />
  );
}

/** The line under the frame: what is heard, what the words go to, a hint. */
export function PromptInputHint({ className, tone, ...props }: ComponentProps<'div'> & { tone?: 'working' | 'warn' }) {
  return (
    <div
      data-slot="prompt-input-hint"
      className={cn('-mt-1 basis-full text-[11.5px] text-muted-foreground', tone === 'working' && 'text-working [&_b]:text-working', tone === 'warn' && 'text-warn', className)}
      {...props}
    />
  );
}
