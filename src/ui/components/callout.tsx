




import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type { ComponentProps } from 'react';
import { Alert, AlertDescription, AlertTitle } from './alert';

const calloutVariants = cva('', {
  variants: {
    kind: {
      info: '',
      success: 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-50',
      warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50',
      error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-50',
      note: 'border-purple-200 bg-purple-50 text-purple-900 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-50',
      'bold-info': 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-50',
    },
  },
  compoundVariants: [{ kind: ['success', 'warn', 'error', 'note', 'bold-info'], className: '*:data-[slot=alert-description]:text-current/85' }],
  defaultVariants: { kind: 'info' },
});

type CalloutKind = NonNullable<VariantProps<typeof calloutVariants>['kind']>;

function Callout({ className, kind = 'info', ...props }: Omit<ComponentProps<typeof Alert>, 'variant'> & { kind?: CalloutKind }) {
  return <Alert data-slot="callout" data-kind={kind} className={cn(calloutVariants({ kind }), className)} {...props} />;
}

export { Callout, AlertDescription as CalloutDescription, AlertTitle as CalloutTitle, type CalloutKind, calloutVariants };
