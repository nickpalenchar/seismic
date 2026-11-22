// The quick project switcher: ⌘P (Ctrl+P elsewhere) opens a search field over the page with the
// projects under it, the best match first; the arrow keys move through them, Enter goes to the one
// marked, Esc closes it. The project open now comes last, since the owner opens it to leave.

import { useEffect, useState } from 'react';
import { counted, type InboxEntry } from '../core/inbox';
import type { ProjectInfo } from '../core/types';
import { goTo, projectPath } from './address';
import { ProjectIcon } from './canvasIcon';
import { Badge } from './components/badge';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './components/command';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { t } from './strings';

/** Whether a key press is the switcher's shortcut: ⌘P or Ctrl+P, without Shift or Alt. */
export const isSwitcherKey = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p';

/** The cards waiting for the owner on each project, by its id, as the bell counts them. */
export function waitingPerProject(entries: InboxEntry[]): Record<string, number> {
  const per: Record<string, number> = {};
  for (const e of entries) if (e.card && counted(e)) per[e.project] = (per[e.project] ?? 0) + 1;
  return per;
}

/** How well `text` matches `query`: a lower rank is better; null where it does not match. */
function rank(name: string, others: string[], query: string): number | null {
  const n = name.toLowerCase();
  if (n.startsWith(query)) return 0;
  if (n.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 1;
  if (n.includes(query)) return 2;
  if (others.some((o) => o.toLowerCase().includes(query))) return 3;
  // the letters in order, with gaps between them ("sms" finds "seismic")
  let at = 0;
  for (const ch of n) if (ch === query[at]) at++;
  return at === query.length ? 4 : null;
}

/**
 * The projects the switcher lists for `query`: by name, then by a repository's name or an old name,
 * then by the name's letters in order; the open project (`current`) after the others.
 */
export function switcherResults(projects: ProjectInfo[], query: string, current: string): ProjectInfo[] {
  const q = query.trim().toLowerCase();
  return projects
    .map((p, index) => ({ p, index, rank: q ? rank(p.name, [...p.repos.map((r) => r.name), ...(p.oldNames ?? [])], q) : 0 }))
    .filter((r): r is typeof r & { rank: number } => r.rank !== null)
    .sort((a, b) => Number(a.p.id === current) - Number(b.p.id === current) || a.rank - b.rank || a.index - b.index)
    .map((r) => r.p);
}

export function ProjectSwitcher({ open, onOpenChange, project, projects, waiting }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project open now. */
  project: string;
  projects: ProjectInfo[];
  /** How many cards wait for the owner on each project, by its id. */
  waiting: Record<string, number>;
}) {
  const [query, setQuery] = useState('');
  // each time it opens, the field starts empty
  useEffect(() => void (open && setQuery('')), [open]);
  const results = switcherResults(projects, query, project);
  const pick = (id: string) => {
    onOpenChange(false);
    if (id !== project) goTo(projectPath(id));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id="project-switcher" glass layerClassName="items-start pt-[14vh]" className="w-[min(560px,100%)] rounded-lg p-2">
        <DialogTitle className="sr-only">{t.projectSwitcher.title}</DialogTitle>
        <Command shouldFilter={false} loop label={t.projectSwitcher.title}>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={t.projectSwitcher.placeholder}
            aria-label={t.projectSwitcher.placeholder}
            className="h-10 border-transparent bg-transparent text-base shadow-none focus:border-transparent focus:bg-transparent"
            spellCheck={false}
          />
          <CommandList className="mt-1 max-h-[min(420px,55vh)] border-t border-border pt-1">
            <CommandEmpty>{t.projectSwitcher.none}</CommandEmpty>
            {results.map((p) => (
              <CommandItem key={p.id} value={p.id} className="px-2.5 py-2 text-sm" onSelect={() => pick(p.id)}>
                <ProjectIcon icon={p.icon} />
                <b className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={p.name}>{p.name}</b>
                <span className="min-w-0 flex-[0_1000_auto] overflow-hidden text-xs text-ellipsis whitespace-nowrap text-muted-foreground">{p.repos.map((r) => r.name).join(', ')}</span>
                <span className="ml-auto flex flex-none items-center gap-2">
                  {!!waiting[p.id] && (
                    <Badge variant="count" tone="waiting" title={t.nav.waiting(waiting[p.id]!)}>
                      {waiting[p.id]}
                    </Badge>
                  )}
                  {p.id === project && <span className="text-xs text-muted-foreground">{t.projectSwitcher.current}</span>}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
