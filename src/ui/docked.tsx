// The container of the sheets on the right: a column docked to the window's edge, from top to
// bottom, that slides in and out. The project is what remains to its left (`--side`, set by App),
// and one is open at a time: Seismic's chat, a plan's, the inbox.

import { createContext, useContext, forwardRef, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from './components/sheet';

export const DockPolicy = createContext(false);

export const Docked = forwardRef<HTMLElement, { id: string; on: boolean; className?: string; label?: string; children: ReactNode }>(function Docked({ id, on, className, label, children }, ref) {
  const besideCard = useContext(DockPolicy);
  return (
    <Sheet open={on} modal={false}>
      <SheetContent
        docked
        id={id}
        ref={ref as React.Ref<HTMLDivElement>}
        className={['sheet', besideCard && 'beside-card', on && 'on', className].filter(Boolean).join(' ')}
        aria-label={label}
      >
        {children}
        <SheetTitle asChild>
          <span className="sr-only">{label ?? id}</span>
        </SheetTitle>
      </SheetContent>
    </Sheet>
  );
});
