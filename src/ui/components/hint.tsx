import { cn } from 'cn';
import { Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';
import { know, useKnown } from '../known';
import { t } from '../strings';
import { CloseButton } from './button';
import { Callout, CalloutDescription, CalloutTitle, type CalloutKind } from './callout';

/**
 * An alert hint: a one-time message as an alert with a ✕ at its top right. Once the owner closes
 * it, or has used what it points to (`know(id)` elsewhere), it no longer shows, until "Reset all
 * hints". `id` is its key, `seismic-<name>-known`.
 */
export function AlertHint({ id, title, children, kind = 'info', icon = <Lightbulb aria-hidden />, className }: {
  id: string;
  title?: ReactNode;
  children: ReactNode;
  kind?: CalloutKind;
  icon?: ReactNode;
  className?: string;
}) {
  if (useKnown(id)) return null;
  return (
    <Callout kind={kind} data-slot="alert-hint" data-hint={id} className={cn('pr-10', className)}>
      {icon}
      {title && <CalloutTitle>{title}</CalloutTitle>}
      <CalloutDescription>{children}</CalloutDescription>
      <CloseButton label={t.hints.dismiss} size="small" className="absolute top-1.5 right-1.5" onClick={() => know(id)} />
    </Callout>
  );
}
