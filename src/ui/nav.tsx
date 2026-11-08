// The navigation at the bar's left: the project's name, and under it the projects, each with the
// count of what waits for the owner there and its agents' pause. It opens as a list under its
// button, or stays pinned as a sidebar docked on the left, the project the rest. What waits itself is
// in the inbox (src/ui/inbox.tsx), on every project at once.

import { GitBranch, PanelLeft, Plus, PanelLeftClose } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ProjectInfo } from '../core/types';
import { projectPath } from './address';
import { ProjectAgents } from './parts';
import { useMenuClose } from './queue';
import { t } from './strings';

/** How wide the navigation is, pinned as a sidebar. */
export const NAV_W = 340;
/** The least room the project keeps beside the pinned navigation and a sheet on the right; with less, it folds back into its button. */
export const NAV_PROJECT_MIN = 480;
const PIN_KEY = 'obeya-nav-pinned';

export const loadPinned = () => {
  try {
    return localStorage.getItem(PIN_KEY) === '1';
  } catch {
    return false;
  }
};
export const savePinned = (on: boolean) => {
  try {
    if (on) localStorage.setItem(PIN_KEY, '1');
    else localStorage.removeItem(PIN_KEY);
  } catch {}
};

interface ListProps {
  project: ProjectInfo;
  projects: ProjectInfo[];
  /** How many things wait for the owner on each project, this one's as this page sees it. */
  counts: Record<string, number>;
  pinned: boolean;
  /** Pinning is offered: the window has room for the sidebar. */
  pinnable: boolean;
  onPin: (on: boolean) => void;
  /** Opens the configuration with a new project added. */
  onNew: () => void;
}

/** The bar's button and the list under it. */
export function NavPill(p: ListProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useMenuClose(open, box, () => setOpen(false), true);
  const home = p.project.repos[0];
  return (
    <div className="nav-pill" ref={box}>
      <button className={open ? 'pill switch on' : 'pill switch'} title={t.nav.button} aria-expanded={open} onClick={() => setOpen(!open)}>
        <ProjectIcon />
        <b>{p.project.name}</b>
        <span className="hint lbl">{p.project.repos.length > 1 ? t.repos(p.project.repos.length) : home?.branch}</span>
        <span className="hint">▾</span>
      </button>
      {open && (
        <div className="nav-menu">
          <NavList
            {...p}
            onPin={(on) => {
              setOpen(false);
              p.onPin(on);
            }}
            onNew={() => {
              setOpen(false);
              p.onNew();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** The navigation pinned as a sidebar on the left, sliding in and out. */
export function NavSheet({ on, ...p }: ListProps & { on: boolean }) {
  // in the app on a Mac it reaches up to the window's top: the traffic lights sit in its head, which moves the window as the bar does
  const titlebar = window.obeyaApp?.platform === 'macos';
  return (
    <aside id="nav" className={['nav-sheet', on && 'on', titlebar && 'titlebar'].filter(Boolean).join(' ')} aria-hidden={!on}>
      <NavList {...p} titlebar={titlebar} />
    </aside>
  );
}

/** The projects in the configuration's order, this one marked; a click on one switches there. */
function NavList({ project, projects, counts, pinned, pinnable, onPin, onNew, titlebar }: ListProps & { titlebar?: boolean }) {
  return (
    <>
      <div className="nav-head" {...(titlebar ? { 'data-tauri-drag-region': '' } : {})}>
        <h2 {...(titlebar ? { 'data-tauri-drag-region': '' } : {})}>{t.nav.title}</h2>
        {(pinnable || pinned) && (
          <button className={pinned ? 'nav-pin on' : 'nav-pin'} title={pinned ? t.nav.unpin : t.nav.pin} aria-label={pinned ? t.nav.unpin : t.nav.pin} aria-pressed={pinned} onClick={() => onPin(!pinned)}>
            {pinned ? <PanelLeftClose size={16} strokeWidth={2} aria-hidden /> : <PanelLeft size={16} strokeWidth={2} aria-hidden />}
          </button>
        )}
      </div>
      <ul className="nav-projects">
        {projects.map((c) => {
          const n = counts[c.id] ?? 0;
          return (
            <li key={c.id} className={c.id === project.id ? 'nav-row on' : 'nav-row'}>
              <a href={projectPath(c.id)} aria-current={c.id === project.id ? 'page' : undefined}>
                <ProjectIcon />
                <b title={c.name}>{c.name}</b>
                <span className="hint">{c.repos.map((r) => r.name).join(', ')}</span>
                {n > 0 && (
                  <span className="waits" title={t.nav.waiting(n)}>
                    {n}
                  </span>
                )}
              </a>
              <ProjectAgents project={c} />
            </li>
          );
        })}
        <li className="nav-row nav-new">
          <button onClick={onNew}>
            <Plus size={15} strokeWidth={2} aria-hidden />
            <b>{t.nav.newProject}</b>
          </button>
        </li>
      </ul>
    </>
  );
}

function ProjectIcon() {
  return <GitBranch size={15} strokeWidth={2} aria-hidden />;
}
