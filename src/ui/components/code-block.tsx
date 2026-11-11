// A block of code: shadcn/ui's code block (`code-block`, from the radix-nova registry), its surface,
// content and lines. Ours: lines can carry a gutter (a diff's two line numbers), added and removed
// lines are tinted green and red like the line counts beside a file, and a split diff puts two lines
// side by side in one row. The copy button, header and footer are left out until something needs them.

import { cva, type VariantProps } from 'class-variance-authority';
import type { ClipboardEvent, ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const codeBlockVariants = cva(
  'group/code-block relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg text-sm has-[>[data-slot=code-block-content]:focus-visible]:ring-3 has-[>[data-slot=code-block-content]:focus-visible]:ring-ring/50 data-[size=sm]:text-xs',
  {
    variants: {
      variant: {
        default: 'border border-input text-foreground has-[>[data-slot=code-block-content]:focus-visible]:border-ring dark:bg-input/30',
        destructive: 'border border-destructive/30 text-destructive dark:border-destructive/40',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function CodeBlock({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ComponentProps<'div'> & VariantProps<typeof codeBlockVariants> & { size?: 'default' | 'sm' }) {
  return <div data-slot="code-block" data-variant={variant} data-size={size} className={cn(codeBlockVariants({ variant }), className)} {...props} />;
}

/**
 * Copies the selected code a line per line. The browser's own text of a selection across the lines
 * runs them together (each line is a box of its own, without a newline in its text) and would take
 * in what is not code: line numbers, the rows between hunks, a note beside a line (`data-copy=skip`).
 * In a split diff, only the side the selection starts on is copied, without the empty cells beside a
 * line the other side has alone.
 */
function copyLines(e: ClipboardEvent<HTMLPreElement>) {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  /** Which side of a split row a node is on (0 old, 1 new); -1 outside a split row, null outside any line. */
  const side = (node: Node | null) => {
    const line = (node instanceof Element ? node : node?.parentElement)?.closest('[data-slot=code-block-line]');
    if (!line) return null;
    const row = line.parentElement;
    return row?.dataset.slot === 'code-block-split-row' ? [...row.children].indexOf(line) : -1;
  };
  // the empty side of a split row is no line of that file
  const picked = [...e.currentTarget.querySelectorAll('[data-slot=code-block-line]:not([data-variant=absent]) > [data-slot=code-block-line-content]')].filter((c) =>
    range.intersectsNode(c),
  );
  if (!picked.length) return;
  // the side the owner started dragging on, whichever way they dragged (a range always runs forward,
  // so its first line can lie on the other side of a row above); from between two hunks, the first line's
  const from = side(selection.anchorNode) ?? side(picked[0]!);
  const text = picked
    .filter((c) => side(c) === from)
    .map((content) => {
      const part = document.createRange();
      part.selectNodeContents(content);
      if (content.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
      if (content.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
      const copy = part.cloneContents();
      copy.querySelectorAll('[data-copy=skip]').forEach((n) => n.remove());
      // an empty line holds a newline of its own, for its height
      return (copy.textContent ?? '').replace(/^\n$/, '');
    })
    .join('\n');
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
}

/** The code: a string (one line per line of it), or `CodeBlockLine`s; `wrap` breaks long lines instead of scrolling. */
export function CodeBlockContent({
  className,
  children,
  style,
  wrap = false,
  lineNumbers = false,
  startLine = 1,
  onCopy,
  ...props
}: ComponentProps<'pre'> & { wrap?: boolean; lineNumbers?: boolean; startLine?: number }) {
  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      data-numbered={lineNumbers || undefined}
      dir="ltr"
      tabIndex={0}
      style={{ counterReset: `line ${startLine - 1}`, ...style }}
      onCopy={(e) => {
        onCopy?.(e);
        if (!e.defaultPrevented) copyLines(e);
      }}
      className={cn(
        'm-0 min-h-0 min-w-0 overflow-auto px-3 py-3 text-start font-mono leading-relaxed outline-none group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:py-2.5 data-wrap:wrap-break-word data-wrap:whitespace-pre-wrap',
        className,
      )}
      {...props}
    >
      <code data-slot="code-block-code" className="grid min-h-lh min-w-max content-start rounded-none bg-transparent p-0 [font:inherit] in-data-numbered:grid-cols-[auto_1fr] in-data-wrap:min-w-0">
        {lineNumbers && typeof children === 'string'
          ? children
              .replace(/\n$/, '')
              .split('\n')
              .map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)
          : children}
      </code>
    </pre>
  );
}

const codeBlockLineVariants = cva(
  "relative -mx-3 block min-h-lh px-3 group-data-[size=sm]/code-block:-mx-2.5 group-data-[size=sm]/code-block:px-2.5 before:min-w-6 before:text-end before:text-muted-foreground after:absolute after:start-1 after:top-0 after:text-muted-foreground after:select-none in-data-numbered:col-span-2 in-data-numbered:grid in-data-numbered:grid-cols-subgrid in-data-numbered:gap-x-3 in-data-numbered:[counter-increment:line] in-data-numbered:before:content-[counter(line)] in-data-numbered:before:select-none data-gutter:grid data-gutter:grid-cols-[auto_1fr] data-gutter:gap-x-3 data-gutter:before:hidden data-gutter:ps-5 group-data-[size=sm]/code-block:data-gutter:ps-5",
  {
    variants: {
      variant: {
        default: '',
        added: "bg-approved/12 after:text-approved after:content-['+']",
        removed: "bg-error/10 after:text-error after:content-['−']",
        highlighted: 'bg-muted',
        /** The empty side of a split diff's row, where the other side has a line the one has not. */
        absent: 'bg-muted/60',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** One line; `gutter` stands before it, out of the selection (a diff's line numbers). */
export function CodeBlockLine({ className, variant = 'default', gutter, children, ...props }: ComponentProps<'span'> & VariantProps<typeof codeBlockLineVariants> & { gutter?: ReactNode }) {
  // An empty line holds a newline, so it keeps the height of a line.
  const empty = children === undefined || children === null || children === '' || (Array.isArray(children) && children.length === 0);
  return (
    <span data-slot="code-block-line" data-variant={variant} data-gutter={gutter !== undefined || undefined} className={cn(codeBlockLineVariants({ variant }), className)} {...props}>
      {gutter !== undefined && (
        <span data-slot="code-block-line-number" className="select-none text-end text-muted-foreground" aria-hidden>
          {gutter}
        </span>
      )}
      <span data-slot="code-block-line-content" className="min-w-0">
        {empty ? '\n' : children}
      </span>
    </span>
  );
}

/** A split diff's row: two lines side by side, each half of the width. */
export function CodeBlockSplitRow({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="code-block-split-row"
      className={cn(
        'grid grid-cols-2 -mx-3 group-data-[size=sm]/code-block:-mx-2.5 *:data-[slot=code-block-line]:mx-0 *:data-[slot=code-block-line]:min-w-0 *:data-[slot=code-block-line]:pe-2 [&>[data-slot=code-block-line]+[data-slot=code-block-line]]:border-s [&>[data-slot=code-block-line]+[data-slot=code-block-line]]:border-input',
        className,
      )}
      {...props}
    />
  );
}
