import type { CSSProperties } from 'react';
import { cn } from 'cn';

/**
 * A short bar that shows something at work: a glow running along it, left to right (the `flow` keyframes in
 * frost.css, which slide its strip, `::after`, under the bar's clipping edge), in `color`, any CSS colour (the working blue by default). Decoration only: what is at work says
 * the text beside it.
 */
function WorkingBar({ color = 'var(--working)', className, style, ...props }: React.ComponentProps<'span'> & { color?: string }) {
  return (
    <span
      aria-hidden
      data-slot="working-bar"
      className={cn(
        "relative inline-block flex-none align-middle w-8.5 h-1 rounded-sm overflow-hidden after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-[400%] after:bg-[linear-gradient(90deg,transparent,var(--bar),transparent)] after:bg-[length:50%_100%] after:animate-[flow_1.4s_linear_infinite]",
        className,
      )}
      style={{ '--bar': color, ...style } as CSSProperties}
      {...props}
    />
  );
}

export { WorkingBar };
