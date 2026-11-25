

















import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { counted, type InboxEntry, inboxEntries } from '../core/inbox';
import type { ProjectInfo } from '../core/types';
import { goTo, projectPath } from './address';
import { api } from './api';
import { ProjectIcon } from './canvasIcon';
import { Badge } from './components/badge';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './components/command';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { switcherCombo, t } from './strings';

/**
 * Whether a key press is the switcher's shortcut, the key the hint shows (`switcherKeys`): ⌘P on a
 * Mac, an iPhone or an iPad, Ctrl+P elsewhere; without Shift or Alt. Ctrl+P on a Mac stays the
 * system's (the line up in a text field).
 */
export const isSwitcherKey = (
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform = typeof navigator !== 'undefined' ? navigator.platform : '',
) => (switcherCombo(platform)[0] === '⌘' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p';






const OWN_ESC = '#ringback, .lightbox, .artifact-image-close, .chats-drawer';


const LAYERS = '[role=menu], [role=listbox], [data-slot=popover-content]';

/**
 * Where the focus goes back to when the switcher closes, for `el` that had it as the key opened it,
 * where `el` is gone by then: for an element inside a layer, the button that opened that layer (out
 * through nested submenus to the first one outside any). A menu or a popover closes as the
 * switcher takes the focus, and Radix then skips giving it back to their button; a select's list
 * stays open, and its option keeps the focus itself.
 */
export function focusHome(el: HTMLElement): HTMLElement {
  for (let layer = el.closest<HTMLElement>(LAYERS); layer; layer = el.closest<HTMLElement>(LAYERS)) {
    const button = layer.id ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(layer.id)}"]`) : null;
    if (!button || button === el) break;
    el = button;
  }
  return el;
}

/** The cards waiting for the owner on each project, by its id, as the bell counts them. */
export function waitingPerProject(entries: InboxEntry[]): Record<string, number> {
  
  const per: Record<string, number> = Object.create(null);
  for (const e of entries) if (e.card && counted(e)) per[e.project] = (per[e.project] ?? 0) + 1;
  return per;
}

/**
 * The projects and what waits on them, read from the server where no connection tells the switcher:
 * the list goes out as soon as it is read, without waiting for the waiting cards, which follow,
 * counted against that list, once (and if) their read succeeds. A failed read gives nothing.
 */
export async function readProjects(
  from: { projects: () => Promise<ProjectInfo[]>; waiting: typeof api.waiting },
  to: { projects: (list: ProjectInfo[]) => void; waiting: (counts: Record<string, number>) => void },
): Promise<void> {
  
  const waiting = from.waiting().catch(() => null);
  let list: ProjectInfo[];
  try {
    list = await from.projects();
  } catch {
    return;
  }
  to.projects(list);
  const w = await waiting;
  if (w) to.waiting(waitingPerProject(inboxEntries(list, w)));
}

/** How well `text` matches `query`: a lower rank is better; null where it does not match. */
function rank(name: string, others: string[], query: string): number | null {
  const n = name.toLowerCase();
  if (n.startsWith(query)) return 0;
  if (n.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 1;
  if (n.includes(query)) return 2;
  if (others.some((o) => o.toLowerCase().includes(query))) return 3;
  
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


type Feed = { counts: Record<string, number>; shut: boolean };
let feed: Feed | null = null;
const feedListeners = new Set<() => void>();
const setFeed = (f: Feed | null) => {
  feed = f;
  for (const fn of feedListeners) fn();
};
const onFeed = (fn: () => void) => {
  feedListeners.add(fn);
  return () => void feedListeners.delete(fn);
};

/**
 * A page with a project's connection tells the switcher, while it is mounted, what waits on every
 * project (`counts`, as its connection keeps it current) and whether the switcher stays shut (`shut`:
 * what covers the page is about every project, the configuration, the preferences, a phone's
 * pairing). `counts` null tells nothing (yet): what was told before stands (the splash leaves the
 * word to the project that takes its place), and where nothing was, the switcher reads from the server.
 */
export function useSwitcherFeed(counts: Record<string, number> | null, shut = false) {
  const said = counts && `${shut} ${JSON.stringify(counts)}`;
  useEffect(() => void (counts && setFeed({ counts, shut })), [said]);
  useEffect(() => () => setFeed(null), []);
}

export function ProjectSwitcher({ project, projects, onProjects }: {
  
  project: string;
  projects: ProjectInfo[];
  
  onProjects: (list: ProjectInfo[], previous: ProjectInfo[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  
  
  
  const opener = useRef<{ el: HTMLElement; home: HTMLElement } | null>(null);
  const told = useSyncExternalStore(onFeed, () => feed);
  const shut = !!told?.shut;
  
  const ousted = useRef(false);
  useEffect(() => {
    if (!shut || !open) return;
    ousted.current = true;
    setOpen(false);
  }, [shut]);
  
  
  
  const [read, setRead] = useState<Record<string, number>>(() => waitingPerProject([]));
  useEffect(() => {
    if (!open || told) return;
    let on = true;
    void readProjects(api, {
      projects: (list) => on && onProjects(list, projects),
      waiting: (counts) => on && setRead(counts),
    });
    return () => void (on = false);
  }, [open, !told]);
  useEffect(() => {
    
    const key = (e: KeyboardEvent) => {
      if (!isSwitcherKey(e)) return;
      
      e.preventDefault();
      if (e.repeat || (!open && (shut || document.querySelector(OWN_ESC)))) return;
      const el = document.activeElement;
      if (!open) opener.current = el instanceof HTMLElement && el !== document.body ? { el, home: focusHome(el) } : null;
      setOpen(!open);
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [open, shut]);
  const waiting = told?.counts ?? read;
  const pick = (id: string) => {
    setOpen(false);
    if (id !== project) goTo(projectPath(id));
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        id="project-switcher"
        glass
        
        layerClassName="z-1010 items-start pt-[14vh]"
        className="w-[min(560px,100%)] rounded-lg p-2"
        
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          field.current?.focus();
        }}
        
        
        
        onEscapeKeyDown={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          const was = opener.current;
          opener.current = null;
          if (ousted.current) {
            ousted.current = false;
            e.preventDefault();
            return;
          }
          const el = was && (was.el.isConnected ? was.el : was.home);
          if (!el?.isConnected || el.closest('[inert]')) return;
          e.preventDefault();
          el.focus({ preventScroll: true });
        }}
      >
        <DialogTitle className="sr-only">{t.projectSwitcher.title}</DialogTitle>
        <Search field={field} projects={projects} project={project} waiting={waiting} onPick={pick} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The field and the projects that match it, inside the open switcher only: shut, it ranks nothing
 * as the page under it changes, and each time it opens the field starts empty.
 */
function Search({ field, projects, project, waiting, onPick }: {
  field: RefObject<HTMLInputElement | null>;
  projects: ProjectInfo[];
  project: string;
  waiting: Record<string, number>;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const results = switcherResults(projects, query, project);
  
  
  return (
    <Command shouldFilter={false} loop vimBindings={switcherCombo()[0] !== '⌘'} label={t.projectSwitcher.title}>
      <CommandInput
        ref={field}
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
          <CommandItem key={p.id} value={p.id} className="px-2.5 py-2 text-sm" onSelect={() => onPick(p.id)}>
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
  );
}
