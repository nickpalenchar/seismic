import { cn } from 'cn';


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
