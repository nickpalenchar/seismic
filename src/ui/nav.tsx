// The left menu, behind ☰ and the logo in the bar: the inbox, the agents' configuration (a page of its
// own that slides in), the projects (the open one with its canvases and views, every other one with the
// count of what waits for the owner there and its agents' pause) and Seismic's settings and help. It
// drops down under ☰, or stays docked as a sidebar on the left, the project the rest. The floating
// row's project switcher lists the projects alone, while the menu is not docked. What waits itself is
// in the inbox (src/ui/inbox.tsx), on every project at once.

import { Archive, ArrowLeft, Bot, Car, ChartLine, ChevronRight, FileCheck, GitBranch, Inbox, ListOrdered, Menu, PanelLeft, PanelLeftClose, Plus, ScrollText, Settings, SlidersHorizontal, Users } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import type { Canvas, ProjectInfo } from '../core/types';
import { projectPath, switchTo } from './address';
import { CanvasIcon } from './canvasIcon';
import { Sign, Wordmark } from './logo';
import { ProjectAgents } from './parts';
import { useMenuClose } from './queue';
import { t } from './strings';
import { openWish } from './wish';

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
  /** How many things wait for the owner on each project, this one's as this page sees it. */
  counts: Record<string, number>;
  /** Opens the configuration with a new project added. */
  onNew: () => void;
}

/** The floating row's switcher: the project's name, and under it the projects. */
export function NavPill(p: ProjectsProps) {
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
        <div className="nav-menu nav-switch">
          <ul className="nav-projects">
            {p.projects.map((c) => (
              <ProjectRow key={c.id} project={c} here={c.id === p.project.id} count={p.counts[c.id] ?? 0} repos />
            ))}
            <NewProject
              onNew={() => {
                setOpen(false);
                p.onNew();
              }}
            />
          </ul>
        </div>
      )}
    </div>
  );
}

/** What the menu's entries open; a floating menu closes first. */
export interface MenuActions {
  /** Unread entries of the inbox, counted beside its entry. */
  inboxCount: number;
  onInbox: () => void;
  onPerformance: () => void;
  onFeedbackLog: () => void;
  /** The open project's canvases, the one shown marked while no other view covers it. */
  canvases: Canvas[];
  canvas?: string;
  /** Per canvas, the cards on it waiting for the owner. */
  canvasWaiting: Record<string, number>;
  onCanvas: (c: Canvas) => void;
  /** Cards waiting in the queue and parked ones, counted in grey. */
  queued: number;
  parked: number;
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
  const box = useRef<HTMLDivElement>(null);
  useMenuClose(open, box, () => setOpen(false), true);
  const on = docked ? dockedOn : open;
  return (
    <div className="menu-pill app-menu" ref={box}>
      <button className={on ? 'app-logo on' : 'app-logo'} title={t.leftMenu.button} aria-label={t.leftMenu.button} aria-expanded={on} onClick={() => (docked ? onDocked(!dockedOn) : setOpen(!open))}>
        <Menu className="burger" size={18} strokeWidth={2} aria-hidden />
        <span className="bar-word">
          <Wordmark height={22} />
        </span>
        <span className="bar-sign">
          <Sign size={24} />
        </span>
      </button>
      {open && !docked && (
        <div className="nav-menu left-menu">
          <MenuBody {...p} close={() => setOpen(false)} />
        </div>
      )}
    </div>
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
function MenuBody({ close, titlebar, ...p }: MenuProps & { close?: () => void; titlebar?: boolean }) {
  const [page, setPage] = useState<'main' | 'agents'>('main');
  const m = t.leftMenu;
  const drag = titlebar ? { 'data-tauri-drag-region': '' } : {};
  /** An entry's action: a floating menu closes first. */
  const run = (f: () => void) => () => {
    close?.();
    f();
  };
  const pin = (p.pinnable || p.pinned) && (
    <button className={p.pinned ? 'nav-pin on' : 'nav-pin'} title={p.pinned ? m.unpin : m.pin} aria-label={p.pinned ? m.unpin : m.pin} aria-pressed={p.pinned} onClick={run(() => p.onPin(!p.pinned))}>
      {p.pinned ? <PanelLeftClose size={16} strokeWidth={2} aria-hidden /> : <PanelLeft size={16} strokeWidth={2} aria-hidden />}
    </button>
  );
  const inbox = (
    <Entry icon={<Inbox size={16} strokeWidth={2} aria-hidden />} label={m.inbox} on={p.showing === 'inbox'} onClick={run(p.onInbox)} end={p.inboxCount > 0 && <span className="waits">{p.inboxCount}</span>} />
  );
  return (
    <div className={page === 'agents' ? 'menu-pages sub' : 'menu-pages'}>
      <div className="menu-page" inert={page !== 'main'}>
        {/* in the app on a Mac the traffic lights take the head; the inbox's entry follows under it */}
        <div className="nav-head" {...drag}>
          {!titlebar && <ul className="menu-list grow">{inbox}</ul>}
          {pin}
        </div>
        <ul className="menu-list">
          {titlebar && inbox}
          <Entry icon={<Bot size={16} strokeWidth={2} aria-hidden />} label={m.configureAgents} onClick={() => setPage('agents')} end={<ChevronRight size={16} strokeWidth={2} className="more" aria-hidden />} />
        </ul>
        <h3 className="menu-label">{m.projects}</h3>
        <ul className="nav-projects">
          {p.projects.map((c) =>
            c.id === p.project.id ? (
              <li key={c.id} className="nav-open">
                <ul className="nav-projects">
                  <ProjectRow project={c} here count={p.counts[c.id] ?? 0} />
                </ul>
                <ul className="menu-list nav-tree">
                  {p.canvases.map((v) => (
                    <Entry key={v.id} icon={<CanvasIcon canvas={v} size={15} />} label={v.name} on={!p.showing && v.id === p.canvas} onClick={run(() => p.onCanvas(v))} end={!!p.canvasWaiting[v.id] && <span className="waits">{p.canvasWaiting[v.id]}</span>} />
                  ))}
                  <Entry icon={<ListOrdered size={16} strokeWidth={2} aria-hidden />} label={m.queue} on={p.showing === 'queue'} onClick={run(p.onQueue)} end={p.queued > 0 && <span className="grey">{p.queued}</span>} />
                  <Entry icon={<Car size={16} strokeWidth={2} aria-hidden />} label={m.parked} on={p.showing === 'parked'} onClick={run(p.onParked)} end={p.parked > 0 && <span className="grey">{p.parked}</span>} />
                  <Entry icon={<Archive size={16} strokeWidth={2} aria-hidden />} label={m.archived} on={p.showing === 'archived'} onClick={run(p.onArchived)} />
                  <Entry icon={<Settings size={16} strokeWidth={2} aria-hidden />} label={m.projectSettings} on={p.showing === 'settings'} onClick={run(p.onProjectSettings)} end={<ChevronRight size={16} strokeWidth={2} className="more" aria-hidden />} />
                </ul>
              </li>
            ) : (
              <ProjectRow key={c.id} project={c} here={false} count={p.counts[c.id] ?? 0} onGo={close} />
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
      <div className="menu-page" inert={page !== 'agents'}>
        <div className="nav-head" {...drag}>
          <button className="menu-back" onClick={() => setPage('main')} title={m.back} aria-label={m.back}>
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
            <b>{m.configureAgents}</b>
          </button>
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
    </div>
  );
}

/** One of the menu's entries: an icon, its label and what stands at its end; greyed out with "Coming soon" while it opens nothing yet. */
function Entry({ icon, label, end, on, soon, onClick }: { icon?: ReactNode; label: string; end?: ReactNode; on?: boolean; soon?: boolean; onClick?: () => void }) {
  return (
    <li>
      <button className={on ? 'menu-entry on' : 'menu-entry'} aria-current={on || undefined} disabled={soon} title={soon ? t.leftMenu.comingSoon : undefined} onClick={onClick}>
        {icon}
        <span className="menu-entry-label">{label}</span>
        {soon ? <span className="soon">{t.leftMenu.comingSoon}</span> : end}
      </button>
    </li>
  );
}

/** A project's row: a click switches there (the open one stays); its waiting count and its agents' pause. */
function ProjectRow({ project: c, here, count: n, repos, onGo }: { project: ProjectInfo; here: boolean; count: number; repos?: boolean; onGo?: () => void }) {
  return (
    <li className={here ? 'nav-row on' : 'nav-row'}>
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
        {n > 0 && (
          <span className="waits" title={t.nav.waiting(n)}>
            {n}
          </span>
        )}
      </a>
      <ProjectAgents project={c} />
    </li>
  );
}

function NewProject({ onNew }: { onNew: () => void }) {
  return (
    <li className="nav-row nav-new">
      <button onClick={onNew}>
        <Plus size={15} strokeWidth={2} aria-hidden />
        <b>{t.nav.newProject}</b>
      </button>
    </li>
  );
}

function ProjectIcon() {
  return <GitBranch size={15} strokeWidth={2} aria-hidden />;
}
