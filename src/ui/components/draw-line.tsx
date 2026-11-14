import type { CSSProperties } from 'react';
import { cn } from 'cn';

/**
 * The moving line of something at work: a pencil stroke drawn over its faint track, again and again, in `color`, any
 * CSS colour (the working blue by default). The stroke, `::after`, slides in from the left under the line's clipping
 * edge and out to the right (the `draw` keyframes in frost.css): a move the compositor does on its own. Size and place
 * come with `className` (2 px high and 36 px wide by default). Decoration only: what is at work says the text beside it.
 */
function DrawLine({ color = 'var(--working)', className, style, ...props }: React.ComponentProps<'span'> & { color?: string }) {
  return (
    <span
      aria-hidden
      data-slot="draw-line"
      className={cn(
        "relative inline-block flex-none align-middle w-9 h-0.5 overflow-hidden bg-[color:--alpha(var(--draw)/22%)] after:content-[''] after:absolute after:inset-0 after:bg-[var(--draw)] after:animate-[draw_1.6s_cubic-bezier(.5,0,.3,1)_infinite]",
        className,
      )}
      style={{ '--draw': color, ...style } as CSSProperties}
      {...props}
    />
  );
}

export { DrawLine };
