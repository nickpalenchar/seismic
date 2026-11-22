// The quick project switcher: ⌘P on a Mac (Ctrl+P elsewhere) opens a search field over the page with the
// projects under it, the best match first; the arrow keys move through them, Enter goes to the one
// marked, Esc closes it. The project open now comes last, since the owner opens it to leave. Each
// page that shows a project or waits for one (the canvas, the Agent Feedback Log, an address naming
// none, the splash while the project loads or its server does not answer) mounts it,
// and it listens for its key itself. While what is about every project and not this one covers the
// page (the configuration, the preferences, the performance dashboard, a phone's pairing,
// the new project's form), the key does nothing; over
// the project's own dialogs it opens on top, the card's diff included; over the
// overlays that take Esc themselves before any dialog hears it (`OWN_ESC`) it stays shut.

import { useEffect, useRef, useState } from 'react';
import { counted, type InboxEntry, inboxEntries } from '../core/inbox';
import type { ProjectInfo } from '../core/types';
import { goTo, projectPath } from './address';
import { api } from './api';
import { ProjectIcon } from './canvasIcon';
import { Badge } from './components/badge';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './components/command';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { t } from './strings';

/**
 * Whether a key press is the switcher's shortcut, the key the hint shows (`switcherKeys`): ⌘P on a
 * Mac, an iPhone or an iPad, Ctrl+P elsewhere; without Shift or Alt. Ctrl+P on a Mac stays the
 * system's (the line up in a text field).
 */
export const isSwitcherKey = (
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform = typeof navigator !== 'undefined' ? navigator.platform : '',
) => (/Mac|iPhone|iPad/.test(platform) ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p';

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

export function ProjectSwitcher({ project, projects, entries, shut = false }: {
  /** The project open now. */
  project: string;
  projects: ProjectInfo[];
  /** What waits for the owner on every project, for the counts beside them; without it, read from the server as it opens. */
  entries?: InboxEntry[];
  /** What covers the project is about every project (the configuration, the preferences, a phone's pairing): the key does nothing meanwhile. */
  shut?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  // what had the focus when the key opened it, which gets it back on Esc. Noted at the key press, since
  // the dialog's own note comes too late where the focus was in another cmdk field (the card finder):
  // cmdk moves it into the switcher's field as the list mounts, so the dialog would see it there already
  const opener = useRef<{ el: HTMLElement; home: HTMLElement } | null>(null);
  // what waits on every project where the page has no project's connection to tell it
  const [read, setRead] = useState<InboxEntry[]>([]);
  useEffect(() => {
    if (!open || entries) return;
    let on = true;
    api.waiting().then((w) => on && setRead(inboxEntries(projects, w)), () => {});
    return () => void (on = false);
  }, [open, !entries]);
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
  // each time it opens, the field starts empty
  useEffect(() => void (open && setQuery('')), [open]);
  const waiting = waitingPerProject(open ? (entries ?? read) : []);
  const results = switcherResults(projects, query, project);
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
          const el = was && (was.el.isConnected ? was.el : was.home);
          if (!el?.isConnected || el.closest('[inert]')) return;
          e.preventDefault();
          el.focus({ preventScroll: true });
        }}
      >
        <DialogTitle className="sr-only">{t.projectSwitcher.title}</DialogTitle>
        <Command shouldFilter={false} loop label={t.projectSwitcher.title}>
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
