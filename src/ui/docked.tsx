



import { createContext, useContext, forwardRef, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from './components/sheet';

export const DockPolicy = createContext(false);






const sheetClass =
  'resizing:[transition:none]! [&>.p-kind:first-child]:mr-10 [&>.p-kind:first-child+h2]:mr-10 [&>h2:first-child]:mr-10 [@media(max-width:760px)]:w-auto [@media(max-width:760px)]:left-[14px] [@media(max-width:760px)]:right-[14px] [@media(max-width:760px)]:top-16 [@media(max-width:760px)]:bottom-[158px]';


export const sheetTitleClass = 'mt-0.5 mb-2 text-2xl leading-[1.15]';

export const Docked = forwardRef<HTMLElement, { id: string; on: boolean; className?: string; label?: string; children: ReactNode }>(function Docked({ id, on, className, label, children }, ref) {
  const besideCard = useContext(DockPolicy);
  return (
    <Sheet open={on} modal={false}>
      <SheetContent
        docked
        id={id}
        ref={ref as React.Ref<HTMLDivElement>}
        className={['sheet', besideCard && 'beside-card z-41', on && 'on', sheetClass, className].filter(Boolean).join(' ')}
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
