import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, Files } from 'lucide-react';
import type { ChangeRow } from '../core/files';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/collapsible';
import { Button } from './components/button';
import { diffTreeEntries } from './diff-tree-entries';
import { scrollBehavior } from './motion';
import { t } from './strings';

/** Only changed paths enter the navigator; directories organize them without hiding status. */
export function DiffTreeLayout({ rows, current, onPick, children }: { rows: ChangeRow[]; current?: string; onPick: (path: string) => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(true);
  const selection = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    if (picked && !wide) selection.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [picked]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWide(entry!.contentRect.width >= 900));
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  return <Collapsible open={open} onOpenChange={setOpen}><div ref={box} className="diff-browser" data-wide={wide} data-open={open}>
    <div className="diff-tree-toggle"><CollapsibleTrigger asChild><Button size="small" variant="ghost" aria-expanded={open}><Files size={15} />{open ? t.diff.hideTree : t.diff.showTree}</Button></CollapsibleTrigger></div>
    <CollapsibleContent asChild forceMount hidden={!open}><nav className="diff-tree" aria-label={t.diff.showTree}><Tree rows={rows.filter(r => r.kind && !r.dir)} current={current} onPick={(path) => { onPick(path); setPicked(n => n + 1); }} /></nav></CollapsibleContent>
    <div className="diff-selection" ref={selection}>{children}</div>
  </div></Collapsible>;
}

function Tree({ rows, current, onPick, prefix = '' }: { rows: ChangeRow[]; current?: string; onPick: (path: string) => void; prefix?: string }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  return <ul>{diffTreeEntries(rows, prefix).map(({ name, path, file, children }) => {
    const expanded = !closed.has(path);
    return <li key={path}>
      {file && <Button variant="ghost" size="small" className={current === path ? 'selected' : ''} aria-current={current === path ? 'true' : undefined} title={file.from ? `${file.from} → ${path}` : path} onClick={() => onPick(path)}>
        <span className={`diff-status ${file.kind}`} title={t.diff.treeStatus[file.kind!]} aria-label={t.diff.treeStatus[file.kind!]}>{({ added: '+', deleted: '−', moved: '↪', modified: 'M' })[file.kind!]}</span><span className="diff-tree-name">{name}</span>
      </Button>}
      {children.length > 0 && <Collapsible open={expanded} onOpenChange={() => setClosed(was => { const next = new Set(was); next.has(path) ? next.delete(path) : next.add(path); return next; })}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="small" aria-expanded={expanded}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={14} /><span>{file ? `${name}/` : name}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent forceMount hidden={!expanded}><Tree rows={children} prefix={`${path}/`} current={current} onPick={onPick} /></CollapsibleContent>
      </Collapsible>}
    </li>;
  })}</ul>;
}
