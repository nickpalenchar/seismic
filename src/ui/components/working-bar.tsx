import type { CSSProperties } from 'react';
import { cn } from 'cn';

/**
 * A short bar that shows something at work: a glow running along it, left to right (the `flow` keyframes in
 * frost.css), in `color`, any CSS colour (the working blue by default). Decoration only: what is at work says
 * the text beside it.
 */
function WorkingBar({ color = 'var(--working)', className, style, ...props }: React.ComponentProps<'span'> & { color?: string }) {
  return (
    <span
      aria-hidden
      data-slot="working-bar"
      className={cn(
        'inline-block flex-none align-middle w-8.5 h-1 rounded-sm bg-[linear-gradient(90deg,transparent,var(--bar),transparent)] bg-[length:200%_100%] animate-[flow_1.4s_linear_infinite]',
        className,
      )}
      style={{ '--bar': color, ...style } as CSSProperties}
      {...props}
    />
  );
}

export { WorkingBar };
