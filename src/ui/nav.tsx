// The left menu, behind ☰ and the logo in the bar: the inbox, the agents' configuration (a page of its
// own that slides in), the projects (the open one with its canvases and views, every other one with the
// agents' pause) and Seismic's settings and help. It
// drops down under ☰, or stays docked as a sidebar on the left, the project the rest. The floating
// row's project switcher lists the projects alone, while the menu is not docked. What waits itself is
// in the inbox (src/ui/inbox.tsx), on every project at once.

import { Archive, ArrowLeft, Bot, Car, ChartLine, ChevronRight, FileCheck, GitBranch, Inbox, ListOrdered, Menu as Menu_, PanelLeft, PanelLeftClose, Plus, ScrollText, Settings, SlidersHorizontal, Users } from 'lucide-react';
import { type ComponentProps, createContext, type ReactNode, useContext, useState } from 'react';
import type { Canvas, ProjectInfo } from '../core/types';
import { projectPath, switchTo } from './address';
import { CanvasIcon } from './canvasIcon';
import { Sign, Wordmark } from './logo';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './components/menu';
import { ProjectAgents } from './parts';
import { t } from './strings';
import { openWish } from './wish';
import { Tooltip } from './components/tooltip';

/** How wide the menu is, docked as a sidebar. */
export const NAV_W = 340;
/** The least room the project keeps beside the docked menu and a sheet on the right; with less, it folds back under ☰. */
export const NAV_PROJECT_MIN = 480;
const PIN_KEY = 'obeya-nav-pinned';
// docked, ☰ hides the menu and shows it again; it stays docked meanwhile
const HIDDEN_KEY = 'obeya-nav-hidden';

const loadFlag = (key: string) => () => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const saveFlag = (key: string) => (on: boolean) => {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {}
};
export const loadPinned = loadFlag(PIN_KEY);
export const savePinned = saveFlag(PIN_KEY);
export const loadNavHidden = loadFlag(HIDDEN_KEY);
export const saveNavHidden = saveFlag(HIDDEN_KEY);

interface ProjectsProps {
  project: ProjectInfo;
  projects: ProjectInfo[];
  /** Opens the configuration with a new project added. */
  onNew: () => void;
}

/** The floating row's switcher: the project's name, and under it the projects. */
export function NavPill(p: ProjectsProps) {
  const [open, setOpen] = useState(false);
  const home = p.project.repos[0];
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <div className="nav-pill">
        <MenuTrigger asChild>
          <button className={open ? 'pill project-switch on' : 'pill project-switch'} title={t.nav.button}>
            <ProjectIcon />
            <b>{p.project.name}</b>
            <span className="hint lbl">{p.project.repos.length > 1 ? t.repos(p.project.repos.length) : home?.branch}</span>
            <span className="hint">▾</span>
          </button>
        </MenuTrigger>
      </div>
      <MenuContent className="nav-menu nav-switch">
        <InMenu.Provider value={ACTIVE}>
          <ul className="nav-projects">
            {p.projects.map((c) => (
              <ProjectRow key={c.id} project={c} here={c.id === p.project.id} repos />
            ))}
            <NewProject onNew={p.onNew} />
          </ul>
        </InMenu.Provider>
      </MenuContent>
    </Menu>
  );
}

/**
 * Whether the entries below are items of an open dropdown (`active`: its page is showing, else they
 * are skipped by the arrow keys) or plain buttons and links in the docked sidebar (no provider).
 */
const InMenu = createContext<{ active: boolean } | null>(null);
const ACTIVE = { active: true };
const INACTIVE = { active: false };

/** What the menu's entries open; a floating menu closes first. */
export interface MenuActions {
  onInbox: () => void;
  onPerformance: () => void;
  onFeedbackLog: () => void;
  /** The open project's canvases, the one shown marked while no other view covers it. */
  canvases: Canvas[];
  canvas?: string;
  onCanvas: (c: Canvas) => void;
  onQueue: () => void;
  onParked: () => void;
  onArchived: () => void;
  onProjectSettings: () => void;
  /** Which of the open project's views is showing, marked in the menu. */
  showing?: 'archived' | 'inbox' | 'parked' | 'queue' | 'settings';
  /** The configuration: every project, its repositories, Seismic's agents, voice, demos. */
  onConfig: () => void;
  onPrefs: () => void;
  onHelp: () => void;
}

export interface MenuProps extends ProjectsProps, MenuActions {
  /** Docked as a sidebar (it may still be folded back, see `docked`). */
  pinned: boolean;
  /** Docking is offered: the window has room for the sidebar. */
  pinnable: boolean;
  onPin: (on: boolean) => void;
}

/**
 * ☰ and the logo in the bar, so it reads as a button. Docked, a click hides the sidebar or shows it
 * again; otherwise the menu drops down under it. Narrow, the bar shows the sign alone in it (barFit.ts).
 */
export function MenuButton({ docked, dockedOn, onDocked, ...p }: MenuProps & { docked: boolean; dockedOn: boolean; onDocked: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const on = docked ? dockedOn : open;
  const logo = (
    <button className={on ? 'app-logo on' : 'app-logo'} aria-label={t.leftMenu.button} aria-expanded={docked ? dockedOn : undefined} onClick={docked ? () => onDocked(!dockedOn) : undefined}>
      <Menu_ className="burger" size={18} strokeWidth={2} aria-hidden />
      <span className="bar-word">
        <Wordmark height={22} />
      </span>
      <span className="bar-sign">
        <Sign size={24} />
      </span>
    </button>
  );
  return (
    <Menu open={open && !docked} onOpenChange={setOpen}>
      <div className="app-menu">
        {/* docked, the button toggles the sidebar: a trigger would swallow Enter and Space to open a menu that is not there */}
        <Tooltip content={t.leftMenu.button}>{docked ? logo : <MenuTrigger asChild>{logo}</MenuTrigger>}</Tooltip>
      </div>
      <MenuContent className="nav-menu left-menu">
        <MenuBody {...p} floating />
      </MenuContent>
    </Menu>
  );
}

/** The menu docked as a sidebar on the left, sliding in and out. */
export function NavSheet({ on, ...p }: MenuProps & { on: boolean }) {
  // in the app on a Mac it reaches up to the window's top: the traffic lights sit in its head, which moves the window as the bar does
  const titlebar = window.obeyaApp?.platform === 'macos';
  return (
    <aside id="nav" className={['nav-sheet', 'left-menu', on && 'on', titlebar && 'titlebar'].filter(Boolean).join(' ')} aria-hidden={!on}>
      <MenuBody {...p} titlebar={titlebar} />
    </aside>
  );
}

/** The menu's two pages, the main one and "Configure agents", the second sliding in over the first. */
function MenuBody({ floating, titlebar, ...p }: MenuProps & { floating?: boolean; titlebar?: boolean }) {
  const [page, setPage] = useState<'main' | 'agents'>('main');
  const m = t.leftMenu;
  const drag = titlebar ? { 'data-tauri-drag-region': '' } : {};
  // an entry's action: in the dropdown the menu closes with the choice
  const run = (f: () => void) => f;
  const pin = (p.pinnable || p.pinned) && (
    <Act className={p.pinned ? 'nav-pin on' : 'nav-pin'} tip={p.pinned ? m.unpin : m.pin} aria-label={p.pinned ? m.unpin : m.pin} aria-pressed={p.pinned} onAct={() => p.onPin(!p.pinned)}>
      {p.pinned ? <PanelLeftClose size={16} strokeWidth={2} aria-hidden /> : <PanelLeft size={16} strokeWidth={2} aria-hidden />}
    </Act>
  );
  const inbox = (
    <Entry icon={<Inbox size={16} strokeWidth={2} aria-hidden />} label={m.inbox} on={p.showing === 'inbox'} onClick={run(p.onInbox)} />
  );
  return (
    <div className={page === 'agents' ? 'menu-pages sub' : 'menu-pages'}>
      <InMenu.Provider value={!floating ? null : page === 'main' ? ACTIVE : INACTIVE}>
      <div className="menu-page" inert={page !== 'main'}>
        {/* in the app on a Mac the traffic lights take the head; the inbox's entry follows under it */}
        <div className="nav-head" {...drag}>
          {!titlebar && <ul className="menu-list grow">{inbox}</ul>}
          {pin}
        </div>
        <ul className="menu-list">
          {titlebar && inbox}
          <Entry icon={<Bot size={16} strokeWidth={2} aria-hidden />} label={m.configureAgents} keep onClick={() => setPage('agents')} end={<ChevronRight size={16} strokeWidth={2} className="more" aria-hidden />} />
        </ul>
        <h3 className="menu-label">{m.projects}</h3>
        <ul className="nav-projects">
          {p.projects.map((c) =>
            c.id === p.project.id ? (
              <li key={c.id} className="nav-open">
                <ul className="nav-projects">
                  <ProjectRow project={c} here />
                </ul>
                <ul className="menu-list nav-tree">
                  {p.canvases.map((v) => (
                    <Entry key={v.id} icon={<CanvasIcon canvas={v} size={15} />} label={v.name} on={!p.showing && v.id === p.canvas} onClick={run(() => p.onCanvas(v))} />
                  ))}
                  <Entry icon={<ListOrdered size={16} strokeWidth={2} aria-hidden />} label={m.queue} on={p.showing === 'queue'} onClick={run(p.onQueue)} />
                  <Entry icon={<Car size={16} strokeWidth={2} aria-hidden />} label={m.parked} on={p.showing === 'parked'} onClick={run(p.onParked)} />
                  <Entry icon={<Archive size={16} strokeWidth={2} aria-hidden />} label={m.archived} on={p.showing === 'archived'} onClick={run(p.onArchived)} />
                  <Entry icon={<Settings size={16} strokeWidth={2} aria-hidden />} label={m.projectSettings} on={p.showing === 'settings'} onClick={run(p.onProjectSettings)} end={<ChevronRight size={16} strokeWidth={2} className="more" aria-hidden />} />
                </ul>
              </li>
            ) : (
              <ProjectRow key={c.id} project={c} here={false} />
            ),
          )}
          <NewProject onNew={run(p.onNew)} />
        </ul>
        <ul className="menu-list menu-foot">
          <Entry icon={<SlidersHorizontal size={16} strokeWidth={2} aria-hidden />} label={m.settings} onClick={run(p.onConfig)} />
          <li>
            <ul className="menu-list nav-tree">
              <Entry label={m.prefs} onClick={run(p.onPrefs)} />
              <Entry label={m.help} onClick={run(p.onHelp)} />
              <Entry label={t.wish.link} onClick={run(() => openWish())} />
            </ul>
          </li>
        </ul>
      </div>
      </InMenu.Provider>
      <InMenu.Provider value={!floating ? null : page === 'agents' ? ACTIVE : INACTIVE}>
      <div className="menu-page" inert={page !== 'agents'}>
        <div className="nav-head" {...drag}>
          <Act className="menu-back" keep onAct={() => setPage('main')} tip={m.back} aria-label={m.back}>
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
            <b>{m.configureAgents}</b>
          </Act>
          {pin}
        </div>
        <ul className="menu-list">
          <Entry icon={<Users size={16} strokeWidth={2} aria-hidden />} label={m.agents} soon />
          <Entry icon={<ScrollText size={16} strokeWidth={2} aria-hidden />} label={m.rules} soon />
          <Entry icon={<FileCheck size={16} strokeWidth={2} aria-hidden />} label={m.reviewRules} soon />
          <Entry icon={<ChartLine size={16} strokeWidth={2} aria-hidden />} label={m.performance} onClick={run(p.onPerformance)} />
          <li>
            <ul className="menu-list nav-tree">
              <Entry label={m.feedbackLog} onClick={run(p.onFeedbackLog)} />
            </ul>
          </li>
        </ul>
      </div>
      </InMenu.Provider>
    </div>
  );
}

/** A button of the menu: an item of the open dropdown, else a plain button. `keep` leaves the dropdown open. */
function Act({ onAct, keep, disabled, tip, children, ...props }: { onAct?: (() => void) | undefined; keep?: boolean; disabled?: boolean; tip?: string } & Omit<ComponentProps<'button'>, 'onClick'>) {
  const menu = useContext(InMenu);
  if (!menu) {
    return (
      <Tooltip content={tip}>
        <button {...props} disabled={disabled} onClick={onAct}>{children}</button>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={tip}>
      <MenuItem
        asChild
        disabled={disabled || !menu.active}
        onSelect={(e) => {
          if (keep) e.preventDefault();
          onAct?.();
        }}
      >
        <button {...props}>{children}</button>
      </MenuItem>
    </Tooltip>
  );
}

/** One of the menu's entries: an icon, its label and what stands at its end; greyed out with "Coming soon" while it opens nothing yet. */
function Entry({ icon, label, end, on, soon, keep, onClick }: { icon?: ReactNode; label: string; end?: ReactNode; on?: boolean; soon?: boolean; keep?: boolean; onClick?: () => void }) {
  return (
    <li>
      <Act className={on ? 'menu-entry on' : 'menu-entry'} aria-current={on || undefined} disabled={soon} title={soon ? t.leftMenu.comingSoon : undefined} keep={keep} onAct={onClick}>
        {icon}
        <span className="menu-entry-label">{label}</span>
        {soon ? <span className="soon">{t.leftMenu.comingSoon}</span> : end}
      </Act>
    </li>
  );
}

/** A project's row: a click switches there (the open one stays); its agents' pause. */
function ProjectRow({ project: c, here, repos, onGo }: { project: ProjectInfo; here: boolean; repos?: boolean; onGo?: () => void }) {
  const menu = useContext(InMenu);
  const link = (
    <a
      href={projectPath(c.id)}
      aria-current={here ? 'page' : undefined}
      onClick={(e) => {
        onGo?.();
        switchTo(e, projectPath(c.id));
      }}
    >
      <ProjectIcon />
      <b title={c.name}>{c.name}</b>
      {repos && <span className="hint">{c.repos.map((r) => r.name).join(', ')}</span>}
    </a>
  );
  return (
    <li className={here ? 'nav-row on' : 'nav-row'}>
      {menu ? <MenuItem asChild disabled={!menu.active}>{link}</MenuItem> : link}
      <ProjectAgents project={c} />
    </li>
  );
}

function NewProject({ onNew }: { onNew: () => void }) {
  return (
    <li className="nav-row nav-new">
      <Act onAct={onNew}>
        <Plus size={15} strokeWidth={2} aria-hidden />
        <b>{t.nav.newProject}</b>
      </Act>
    </li>
  );
}

function ProjectIcon() {
  return <GitBranch size={15} strokeWidth={2} aria-hidden />;
}
