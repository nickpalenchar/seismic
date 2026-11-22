// The quick project switcher: ⌘P on a Mac (Ctrl+P elsewhere) opens a search field over the page with the
// projects under it, the best match first; the arrow keys move through them, Enter goes to the one
// marked, Esc closes it. The project open now comes last, since the owner opens it to leave. App
// mounts one beside every desktop page (the canvas, the Agent Feedback Log, an address naming none,
// the splash while the project loads or its server does not answer), where it stays as one page
// takes another's place (the project's first snapshot, a project that turns up, Back): a search in
// it goes on, but for the one case below. It listens for its key itself. A page with a project's
// connection tells it what waits on every project and whether it stays shut (`useSwitcherFeed`);
// without one, it reads the projects and what waits from the server as it opens. While what is about every project and not this one
// covers the page (the configuration, the preferences, the performance dashboard, a phone's
// pairing, the new project's form), the key does nothing; over the project's own dialogs it opens
// on top, the card's diff included; over the overlays that take Esc themselves before any dialog
// hears it (`OWN_ESC`) it stays shut. Where such a view opens while the switcher is open already (the
// performance dashboard a page opens at start, its address asking for it, as the project's first
// snapshot replaces the splash the key was pressed on), the switcher closes, its search dropped (the
// one page change a search does not outlive), and leaves the focus where that view put it: the
// newer dialog holds the focus trap and Esc, so the switcher over it would take no typing.

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

/**
 * The overlays outside the dialogs that close on Esc in the window's capture phase, before a dialog
 * over them could hear it: the right-click rings, a screenshot shown large, an artifact's image full
 * screen, the earlier chats' drawer. Over one of them the switcher would lose its Esc to it.
 */
const OWN_ESC = '#ringback, .lightbox, .artifact-image-close, .chats-drawer';

/** The layers opened from a button (a menu, a submenu, a popover, a select's list). */
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
  // without a prototype: an id such as `constructor` would read an inherited value
  const per: Record<string, number> = Object.create(null);
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

/** What a page with a project's connection tells the switcher: what waits on every project, counted, and whether it stays shut. */
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
  /** The project open now; '' where the address names none. */
  project: string;
  projects: ProjectInfo[];
  /** Publishes the fallback read if the page still has the list it had when the read began. */
  onProjects: (list: ProjectInfo[], previous: ProjectInfo[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // what had the focus when the key opened it, which gets it back on Esc. Noted at the key press, since
  // the dialog's own note comes too late where the focus was in another cmdk field (the card finder):
  // cmdk moves it into the switcher's field as the list mounts, so the dialog would see it there already
  const opener = useRef<{ el: HTMLElement; home: HTMLElement } | null>(null);
  const told = useSyncExternalStore(onFeed, () => feed);
  const shut = !!told?.shut;
  // closed because a view about every project opened over the page: the focus stays in that view
  const ousted = useRef(false);
  useEffect(() => {
    if (!shut || !open) return;
    ousted.current = true;
    setOpen(false);
  }, [shut]);
  // where no project's connection tells it (the feedback log, an address naming none, a project not
  // connected yet), the projects and what waits on them as they are now: one added or removed in
  // another tab meanwhile is found, or is gone
  const [read, setRead] = useState<Record<string, number>>(() => waitingPerProject([]));
  useEffect(() => {
    if (!open || told) return;
    let on = true;
    Promise.all([api.projects(), api.waiting()]).then(([list, w]) => {
      if (!on) return;
      onProjects(list, projects);
      setRead(waitingPerProject(inboxEntries(list, w)));
    }, () => {});
    return () => void (on = false);
  }, [open, !told]);
  useEffect(() => {
    // in the capture phase, so that a field with the cursor or a dialog's own keys come after it
    const key = (e: KeyboardEvent) => {
      if (!isSwitcherKey(e)) return;
      // the browser's print has no place here, also where the switcher stays shut
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
        // over every other layer of the page: the card's diff and a screenshot shown large are the highest, at 1000
        layerClassName="z-1010 items-start pt-[14vh]"
        className="w-[min(560px,100%)] rounded-lg p-2"
        // the field takes the focus, also inside another dialog's trap
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          field.current?.focus();
        }}
        // its Esc closes only the switcher: Radix hears it in the document's capture phase, and the
        // listeners after it (a demo shown larger, the field the focus goes back to) do not.
        // Its default cannot tell them, since the docked sheet prevents it on every Esc
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
  // on a Mac, Ctrl+N/P/J/K stay the field's (a line down and up, cut to the line's end), as Ctrl+P
  // does not open it there; elsewhere cmdk's Vim keys move through the projects, as in every list
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
