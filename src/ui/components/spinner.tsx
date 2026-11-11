import { cn } from '../lib/utils';

/** The shadcn Spinner interface, with a CSS ring instead of its default Lucide icon. */
export function Spinner({ className, ...props }: React.ComponentProps<'span'>) {
  return <span role="status" className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} {...props} />;
}
