import { cn } from 'cn';
import { Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';
import type { HintId } from '../../registries/hintRegistry';
import { useHint } from '../hints';
import { t } from '../strings';
import { CloseButton } from './button';
import { Callout, CalloutDescription, CalloutTitle, type CalloutKind } from './callout';

/**
 * An alert hint: a one-time message as an alert with a ✕ at its top right. Once the owner closes
 * it, or has used what it points to (`markSeen` of its `useHint` elsewhere), it no longer shows,
 * until "Reset all hints". `hintId` is registered in `src/registries/hintRegistry.ts`.
 */
export function AlertHint({ hintId, title, children, kind = 'info', icon = <Lightbulb aria-hidden />, className }: {
  hintId: HintId;
  title?: ReactNode;
  children: ReactNode;
  kind?: CalloutKind;
  icon?: ReactNode;
  className?: string;
}) {
  const hint = useHint(hintId);
  if (!hint.shown) return null;
  return (
    <Callout kind={kind} data-slot="alert-hint" data-hint={hintId} className={cn('pr-10', className)}>
      {icon}
      {title && <CalloutTitle>{title}</CalloutTitle>}
      <CalloutDescription>{children}</CalloutDescription>
      <CloseButton label={t.hints.dismiss} size="small" className="absolute top-1.5 right-1.5" onClick={hint.markSeen} />
    </Callout>
  );
}

/**
 * A label hint: text on a button that is otherwise only an icon, until the owner first uses the
 * button (its `onClick` calls `markSeen` of `useHint(hintId)`). `hintId` is registered in
 * `src/registries/hintRegistry.ts`. It renders in place, so the label's own styling goes in `className`.
 */
export function HintLabel({ hintId, children, className }: { hintId: HintId; children: ReactNode; className?: string }) {
  if (!useHint(hintId).shown) return null;
  return <span data-slot="hint-label" data-hint={hintId} className={className}>{children}</span>;
}
