import { cn } from 'cn';

// Shadcn's Spinner with its default Lucide glyph replaced by a CSS ring.
function Spinner({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      role="status"
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      {...props}
    />
  );
}

export { Spinner };
