
import { cn } from 'cn';
import { useEffect, useRef, useState, type ReactNode, type ComponentType } from 'react';
import { clampWidth, loadWidths, saveWidths, widthsIn, SHEET_W, type SheetWidths } from './sheetWidth';
import { t } from './strings';
import { DockPolicy } from './docked';
import { CloseButton } from './components/button';
import { leave } from './leaving';

export type DockId = 'seismic' | 'plan' | 'plan-doc' | 'needs-you' | 'agents' | 'settings';
export interface DockView {
  id: DockId;
  title: string;
  icon: ComponentType<{ size?: number }>;
  component: () => ReactNode;
  width?: 'read';
  
  buttonCloses?: boolean;
  escape?: () => void;
  close?: () => void;
  
  slot?: string;
  
  besideCard?: boolean;
}

export function useDock(initial: DockId | null) {
  const [active, render] = useState(initial);
  const ref = useRef(active);
  const registry = useRef<DockView[]>([]);
  const selectNow = (id: DockId | null) => { ref.current = id; render(id); };
  
  const select = (id: DockId | null) => (id === ref.current ? selectNow(id) : leave(() => selectNow(id)));
  const view = (id: DockId) => [active === id, (on: boolean) => {
    if (on) select(id);
    else if (ref.current === id) select(null);
  }, { get current() { return ref.current === id; } }] as const;
  const [chosenWidths, setWidths] = useState<SheetWidths>(() => loadWidths(localStorage));
  const widths = widthsIn(chosenWidths, innerWidth);
  const widthRef = useRef(widths);
  widthRef.current = widths;
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) saveWidths(localStorage, chosenWidths);
  }, [chosenWidths, resizing]);
  const selected = () => registry.current.find((v) => v.id === ref.current);
  const close = () => { const v = selected(); if (v?.close) v.close(); else select(null); };
  const escape = () => { const v = selected(); if (v?.escape) v.escape(); else close(); };
  const width = () => ref.current ? widthRef.current[selected()?.width ?? 'sheet'] : 0;
  /** Whether the open view stays usable beside an open card, which then keeps clear of it. */
  const besideCard = () => !!selected()?.besideCard;
  const register = (views: DockView[]) => { registry.current = views; };
  return { active, ref, select, view, widths, setWidths, resizing, setResizing, registry, register, close, escape, width, besideCard };
}


const closeClass = 'fixed top-[14px] right-[14px] z-27 animate-[fade_.3s_ease-out_.2s_backwards] [@media(max-width:760px)]:top-[72px] [@media(max-width:760px)]:right-[22px]';


const gripClass =
  "fixed top-0 bottom-0 w-3 z-26 cursor-ew-resize touch-none opacity-0 pointer-events-none [transition:opacity_.2s,right_.45s_cubic-bezier(.3,.9,.3,1)] resizing:[transition:none] [@media(max-width:760px)]:hidden after:content-[''] after:absolute after:left-1 after:top-1/2 after:w-1 after:h-11 after:-mt-6 after:rounded-xs after:bg-planned after:opacity-55 after:[transition:background_.15s,opacity_.15s,height_.15s,margin-top_.15s] hover:after:bg-muted-foreground hover:after:opacity-100 hover:after:h-16 hover:after:-mt-8 resizing:after:bg-muted-foreground resizing:after:opacity-100 resizing:after:h-16 resizing:after:-mt-8";

export function DockShell({ dock }: { dock: ReturnType<typeof useDock> }) {
  const { active, widths, setWidths, setResizing, close } = dock;
  const views = dock.registry.current;
  const view = views.find((v) => v.id === active);
  const kind = view?.width ?? 'sheet';
  const grip = useRef<{ x: number; w: number; kind: 'sheet' | 'read' } | null>(null);
  const release = () => { grip.current = null; setResizing(false); };
  return <>
    {views.filter((v, i) => !v.slot || views.findIndex((x) => x.slot === v.slot) === i).map((v) => {
      const shown = v.slot ? views.find((x) => x.slot === v.slot && x.id === active) ?? v : v;
      return <DockPolicy.Provider key={v.slot ?? v.id} value={!!shown.besideCard}>{shown.component()}</DockPolicy.Provider>;
    })}
    {view && !view.buttonCloses && <CloseButton id="sheet-close" label={t.close} className={cn(closeClass, view.besideCard && 'beside-card z-42')} onClick={close} />}
    <div id="sheet-grip" className={cn(gripClass, view && 'on opacity-100 pointer-events-auto [transition:opacity_.2s_.3s,right_.45s_cubic-bezier(.3,.9,.3,1)]', view?.besideCard && 'beside-card z-42')} style={{ right: widths[kind] - 6 }} title={t.sheetGrip}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
        grip.current = { x: e.clientX, w: widths[kind], kind }; setResizing(true);
      }}
      onPointerMove={(e) => {
        const g = grip.current;
        if (g) setWidths((ws) => ({ ...ws, [g.kind]: clampWidth(g.w + g.x - e.clientX, innerWidth, g.kind) }));
      }}
      onPointerUp={release} onPointerCancel={release}
      onDoubleClick={() => setWidths((ws) => ({ ...ws, [kind]: kind === 'sheet' ? SHEET_W : null }))} />
  </>;
}
