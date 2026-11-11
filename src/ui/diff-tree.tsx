import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, Files } from 'lucide-react';
import type { ChangeRow } from '../core/files';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/collapsible';
import { Button } from './components/button';
import { t } from './strings';

/** Only changed paths enter the navigator; directories organize them without hiding status. */
export function DiffTreeLayout({ rows, current, onPick, children }: { rows: ChangeRow[]; current?: string; onPick: (path: string) => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [choice, setChoice] = useState<boolean>();
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWide(entry!.contentRect.width >= 900));
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const open = choice ?? wide;
  return <Collapsible open={open} onOpenChange={setChoice}><div ref={box} className="diff-browser" data-wide={wide} data-open={open}>
    <div className="diff-tree-toggle"><CollapsibleTrigger asChild><Button size="small" variant="ghost" aria-expanded={open}><Files size={15} />{open ? t.diff.hideTree : t.diff.showTree}</Button></CollapsibleTrigger></div>
    <CollapsibleContent asChild forceMount hidden={!open}><nav className="diff-tree" aria-label={t.diff.showTree}><Tree rows={rows.filter(r => r.kind)} current={current} onPick={onPick} /></nav></CollapsibleContent>
    <div className="diff-selection">{children}</div>
  </div></Collapsible>;
}

function Tree({ rows, current, onPick, prefix = '' }: { rows: ChangeRow[]; current?: string; onPick: (path: string) => void; prefix?: string }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const groups = new Map<string, ChangeRow[]>();
  for (const row of rows) {
    const name = row.path.slice(prefix.length).split('/')[0]!;
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  return <ul>{[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, entries]) => {
    const path = prefix + name;
    const directory = entries.some(r => r.path !== path);
    const row = entries[0]!;
    const expanded = !closed.has(path);
    return <li key={path}>{directory ? <Collapsible open={expanded} onOpenChange={() => setClosed(was => { const next = new Set(was); next.has(path) ? next.delete(path) : next.add(path); return next; })}>
      <CollapsibleTrigger asChild>
      <Button variant="ghost" size="small" aria-expanded={expanded}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={14} /><span>{name}</span>
      </Button></CollapsibleTrigger>
      <CollapsibleContent forceMount hidden={!expanded}><Tree rows={entries} prefix={`${path}/`} current={current} onPick={onPick} /></CollapsibleContent>
    </Collapsible> : <Button variant="ghost" size="small" className={current === path ? 'selected' : ''} aria-current={current === path ? 'true' : undefined} title={row.from ? `${row.from} → ${path}` : path} onClick={() => onPick(path)}>
      <span className={`diff-status ${row.kind}`} title={t.diff.treeStatus[row.kind!]} aria-label={t.diff.treeStatus[row.kind!]}>{({ added: '+', deleted: '−', moved: '↪', modified: 'M' })[row.kind!]}</span><span className="diff-tree-name">{name}</span>
    </Button>}</li>;
  })}</ul>;
}
