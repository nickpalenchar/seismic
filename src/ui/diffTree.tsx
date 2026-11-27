import { cn } from 'cn';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, Files } from 'lucide-react';
import type { ChangeRow } from '../core/files';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/collapsible';
import { Button } from './components/button';
import { diffTreeEntries } from './diffTreeEntries';
import { scrollBehavior } from './motion';
import { t } from './strings';

/**
 * Only changed paths enter the navigator; directories organize them without hiding status. Wide
 * enough, the tree stands beside the diff; else it is a bar above it that folds. `children` given
 * as a function lays out the diff itself for either case (`stacked`) and brings a picked file into
 * view on its own; else a pick in the stacked tree scrolls to the top of the diff.
 */
export function DiffTreeLayout({ rows, current, onPick, children }: { rows: ChangeRow[]; current?: string; onPick: (path: string) => void; children: ReactNode | ((stacked: boolean) => ReactNode) }) {
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(true);
  const selection = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState(0);
  const ownScroll = typeof children === 'function';
  useEffect(() => {
    if (picked && !wide && !ownScroll) selection.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [picked]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWide(entry!.contentRect.width >= 900));
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const beside = wide && open;
  const files = rows.filter(r => r.kind && !r.dir);
  return <Collapsible open={open} onOpenChange={setOpen}><div ref={box} className={cn('diff-browser grid grid-cols-[minmax(0,1fr)] gap-3', beside && 'grid-cols-[240px_minmax(0,1fr)]')} data-wide={wide} data-open={open}>
    <div className="diff-tree-toggle row-start-1">
      {wide
        ? <CollapsibleTrigger asChild><Button size="small" variant="ghost" aria-expanded={open}><Files size={15} />{open ? t.diff.hideTree : t.diff.showTree}</Button></CollapsibleTrigger>
        : <CollapsibleTrigger className={cn(barTrigger, 'border border-border bg-muted font-medium')}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Files size={15} /><span className="flex-1">{t.diff.showTree}</span><span className="hint">{files.length}</span></CollapsibleTrigger>}
    </div>
    <CollapsibleContent asChild forceMount hidden={!open}><nav className={cn('diff-tree min-w-0 border border-border rounded-md p-2 row-start-2', beside && 'col-start-1 [align-self:start] sticky top-0 max-h-[calc(100vh-8rem)] overflow-auto', !wide && 'max-h-[40vh] overflow-auto')} aria-label={t.diff.showTree}><Tree rows={files} current={current} onPick={(path) => { onPick(path); setPicked(n => n + 1); }} /></nav></CollapsibleContent>
    <div className={cn('diff-selection min-w-0', beside ? 'col-start-2 row-start-2' : wide ? 'row-start-2' : 'row-start-3')} ref={selection}>{typeof children === 'function' ? children(!wide) : children}</div>
  </div></Collapsible>;
}


export const barTrigger = 'flex w-full min-w-0 items-center gap-2 py-1.5 px-2.5 rounded-md text-sm hover:bg-muted [&_svg]:shrink-0 [&_svg]:text-muted-foreground phone:min-h-11';

/** What happened to a file, as a coloured letter. */
export function StatusBadge({ kind }: { kind: NonNullable<ChangeRow['kind']> }) {
  return <span className={cn('diff-status shrink-0 inline-flex items-center justify-center size-4 rounded-xs text-c-strong bg-c/22 font-mono text-2xs/none font-bold', kind, statusColour[kind])} title={t.diff.treeStatus[kind]} aria-label={t.diff.treeStatus[kind]}>{({ added: '+', deleted: '−', moved: '↪', modified: 'M' })[kind]}</span>;
}


const treeButton = 'w-full justify-start min-h-[26px] py-1 px-1.5 [&_svg]:shrink-0 max-[760px]:min-h-11';


const statusColour: Record<NonNullable<ChangeRow['kind']>, string> = {
  added: 'c-approved',
  deleted: 'c-destructive',
  modified: 'c-warning',
  moved: 'c-working',
};

function Tree({ rows, current, onPick, prefix = '' }: { rows: ChangeRow[]; current?: string; onPick: (path: string) => void; prefix?: string }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  return <ul className={cn('list-none m-0 p-0', prefix && 'pl-3.5')}>{diffTreeEntries(rows, prefix).map(({ name, path, file, children }) => {
    const expanded = !closed.has(path);
    return <li key={path}>
      {file && <Button variant="ghost" size="small" className={cn(treeButton, current === path && 'selected bg-muted text-foreground')} aria-current={current === path ? 'true' : undefined} title={file.from ? `${file.from} → ${path}` : path} onClick={() => onPick(path)}>
        <StatusBadge kind={file.kind!} /><span className="diff-tree-name overflow-hidden text-ellipsis">{name}</span>
      </Button>}
      {children.length > 0 && <Collapsible open={expanded} onOpenChange={() => setClosed(was => { const next = new Set(was); next.has(path) ? next.delete(path) : next.add(path); return next; })}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="small" className={treeButton} aria-expanded={expanded}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={14} /><span>{file ? `${name}/` : name}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent forceMount hidden={!expanded}><Tree rows={children} prefix={`${path}/`} current={current} onPick={onPick} /></CollapsibleContent>
      </Collapsible>}
    </li>;
  })}</ul>;
}
