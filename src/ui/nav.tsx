// The left menu, behind ☰ and the logo in the bar: the inbox, the agents' configuration (a page of its
// own that slides in), the projects (the open one with its canvases and views, every other one with the
// agents' pause) and Seismic's settings and help. It
// drops down under ☰, or stays docked as a sidebar on the left, the project the rest. The floating
// row's project switcher lists the projects alone, while the menu is not docked. What waits itself is
// in the inbox (src/ui/inbox.tsx), on every project at once.

import { Archive, ArrowLeft, Bot, Car, ChartLine, ChevronDown, ChevronRight, FileCheck, GitBranch, Inbox, ListOrdered, Menu as Menu_, PanelLeft, PanelLeftClose, Plus, ScrollText, Settings, SlidersHorizontal, Users } from 'lucide-react';
import { type ComponentProps, createContext, type ReactNode, type Ref, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { Canvas, ProjectInfo } from '../core/types';
import { projectPath, switchTo } from './address';
import { CanvasIcon } from './canvasIcon';
import { Sign, Wordmark } from './logo';
import { closeBarMenus, leaveMenu, Menu, MenuContent, MenuItem, MenuTrigger } from './components/menu';
import { ProjectAgents } from './parts';
import { t } from './strings';
import { openWish } from './wish';
import { Tooltip } from './components/tooltip';
import { PillButton } from './components/pill';
import { cn } from 'cn';
import { Sidebar, SidebarContent, SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from './components/sidebar';

// the looks the menu's pieces share, docked or dropped down
const list = 'm-0 list-none p-0';
/** entries under another: the open project's canvases and views, what sits under Settings and Performance */
const tree = cn(list, 'mt-0.5 mb-1 pl-[22px]');
const rowButton = 'flex w-full cursor-pointer items-center gap-[7px] rounded-[6px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] text-muted-foreground no-underline outline-none hover:bg-muted data-highlighted:bg-muted [&_svg]:flex-none';
/** the dropdown's panel: under ☰, or the floating row's project switcher */
const menuPanel = 'w-[min(360px,calc(100vw-28px))] rounded-[12px] border border-glass-edge px-3.5 pt-3.5 pb-4';

/** Default and limits for the docked menu's remembered width. */
export const NAV_W = 256;
export const NAV_MIN_W = 240;
export const NAV_MAX_W = 460;
/** The least room the project keeps beside the docked menu and a sheet on the right; with less, it folds back under ☰. */
export const NAV_PROJECT_MIN = 480;
const WIDTH_KEY = 'seismic-nav-width';
const PIN_KEY = 'seismic-nav-pinned';
// docked, ☰ hides the menu and shows it again; it stays docked meanwhile
const HIDDEN_KEY = 'seismic-nav-hidden';

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
export const loadNavWidth = () => {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value >= NAV_MIN_W && value <= NAV_MAX_W ? value : NAV_W;
  } catch {
    return NAV_W;
  }
};
export const saveNavWidth = (width: number) => {
  try { localStorage.setItem(WIDTH_KEY, String(width)); } catch {}
};

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
      {/* it fits as the bar does (barFit.ts): narrower than its buttons, the row gives up the branch, then the project's name shrinks */}
      <div className="relative flex-none group-data-[fit~='3']/row:min-w-0 group-data-[fit~='3']/row:flex-[0_1_auto]">
        <MenuTrigger asChild>
          <PillButton size="bar" on={open} className="group-data-[fit~='3']/row:max-w-full group-data-[fit~='3']/row:[&_b]:overflow-hidden group-data-[fit~='3']/row:[&_b]:text-ellipsis" title={t.nav.button}>
            <ProjectIcon />
            <b>{p.project.name}</b>
            <span className="text-[12px] text-muted-foreground group-data-[fit~='1']/row:hidden">{p.project.repos.length > 1 ? t.repos(p.project.repos.length) : home?.branch}</span>
            <ChevronDown size={12} strokeWidth={1.75} className="text-muted-foreground" aria-hidden="true" />
          </PillButton>
        </MenuTrigger>
      </div>
      <MenuContent className={menuPanel}>
        <InMenu.Provider value={ACTIVE}>
          <NavList className={list}>
            {p.projects.map((c) => (
              <ProjectRow key={c.id} project={c} here={c.id === p.project.id} repos />
            ))}
            <NewProject onNew={p.onNew} />
          </NavList>
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

function NavList(props: ComponentProps<'ul'>) {
  return useContext(InMenu) ? <ul {...props} /> : <SidebarMenu {...props} className={cn('gap-0', props.className)} />;
}

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
    <button
      data-on={on || undefined}
      className="-ml-1.5 mr-1 flex h-[34px] cursor-pointer items-center gap-[5px] rounded-[3px] border-0 bg-transparent px-1.5 text-foreground hover:bg-foreground/7 data-[on]:bg-foreground/7"
      aria-label={t.leftMenu.button}
      aria-expanded={docked ? dockedOn : undefined}
      onClick={docked ? () => onDocked(!dockedOn) : undefined}
    >
      <Menu_ className="mr-[3px] block flex-none" size={18} strokeWidth={2} aria-hidden />
      {/* narrow, the bar gives up the wordmark for the sign (barFit.ts) */}
      <span className="block leading-0 group-data-[fit~='1']/bar:hidden">
        <Wordmark height={22} />
      </span>
      <span className="hidden leading-0 group-data-[fit~='1']/bar:block">
        <Sign size={24} />
      </span>
    </button>
  );
  return (
    <Menu open={open && !docked} onOpenChange={setOpen}>
      <div>
        {/* docked, the button toggles the sidebar: a trigger would swallow Enter and Space to open a menu that is not there */}
        <Tooltip content={t.leftMenu.button}>{docked ? logo : <MenuTrigger asChild>{logo}</MenuTrigger>}</Tooltip>
      </div>
      <MenuContent className={cn(menuPanel, 'w-[min(310px,calc(100vw-28px))] overflow-x-hidden')}>
        <MenuBody {...p} floating />
      </MenuContent>
    </Menu>
  );
}

/** The menu docked as a sidebar on the left, sliding in and out. */
export function NavSheet({ on, onOpenChange, width, maxWidth, onWidthChange, onWidthEnd, onResizing, ...p }: MenuProps & { on: boolean; onOpenChange: (open: boolean) => void; width: number; maxWidth: number; onWidthChange: (width: number) => void; onWidthEnd: (width: number) => void; onResizing: (active: boolean) => void }) {
  // in the app on a Mac it reaches up to the window's top: the traffic lights sit in its head, which moves the window as the bar does
  const titlebar = window.obeyaApp?.platform === 'macos';
  const grip = useRef<{ x: number; width: number } | null>(null);
  const nextWidth = (width: number) => Math.max(NAV_MIN_W, Math.min(width, NAV_MAX_W, maxWidth));
  const release = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = grip.current;
    if (!drag) return;
    grip.current = null;
    onResizing(false);
    const value = nextWidth(drag.width + e.clientX - drag.x);
    onWidthChange(value);
    onWidthEnd(value);
  };
  const cancel = () => {
    const drag = grip.current;
    if (!drag) return;
    grip.current = null;
    onWidthChange(drag.width);
    onResizing(false);
  };
  return (
    // pinned: a sidebar docked to the window's left edge, from top to bottom, as the sheets are on the
    // right; above the dim of an open card (#dim), so it stays in view and switches project from there
    <SidebarProvider open={on} onOpenChange={onOpenChange} className="contents" style={{ '--sidebar-width': `${width}px` } as React.CSSProperties}>
      <Sidebar
        id="nav"
        aria-hidden={!on}
        inert={!on}
        className={cn(
          'z-31 box-border border border-l-0 border-glass-edge bg-glass shadow-[inset_0_1px_0_var(--glass-hi),var(--lift)] backdrop-blur-[28px] backdrop-saturate-[1.6] [&>[data-sidebar=sidebar-inner]]:bg-transparent',
          'transition-[left,visibility] duration-450 ease-[cubic-bezier(.3,.9,.3,1)]',
          on ? 'visible' : 'invisible [transition-delay:0s,.45s]',
        )}
      >
        <SidebarContent className="px-3.5 pt-3.5 pb-[30px]">
          <SidebarGroup className="p-0">
            <MenuBody {...p} titlebar={titlebar} />
          </SidebarGroup>
        </SidebarContent>
        {on && <button
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label={t.leftMenu.resize}
          aria-valuemin={NAV_MIN_W}
          aria-valuemax={Math.min(NAV_MAX_W, maxWidth)}
          aria-valuenow={width}
          title={t.leftMenu.resizeHint}
          className="group/resize absolute inset-y-0 -right-1.5 z-40 flex w-3 cursor-ew-resize touch-none items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            grip.current = { x: e.clientX, width };
            onResizing(true);
          }}
          onPointerMove={(e) => {
            if (grip.current) onWidthChange(nextWidth(grip.current.width + e.clientX - grip.current.x));
          }}
          onPointerUp={release}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onDoubleClick={() => { const value = nextWidth(NAV_W); onWidthChange(value); onWidthEnd(value); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const value = nextWidth(width + (e.key === 'ArrowRight' ? 16 : -16));
              onWidthChange(value); onWidthEnd(value);
            }
          }}
        ><span className="block h-5 w-1 rounded-full bg-muted-foreground/70 group-hover/resize:bg-foreground group-focus-visible/resize:ring-2 group-focus-visible/resize:ring-working" aria-hidden /></button>}
      </Sidebar>
    </SidebarProvider>
  );
}

/** The menu's two pages, the main one and "Configure agents", the second sliding in over the first. */
function MenuBody({ floating, titlebar, ...p }: MenuProps & { floating?: boolean; titlebar?: boolean }) {
  const [page, setPage] = useState<'main' | 'agents'>('main');
  const previousPage = useRef(page);
  const configureButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (previousPage.current !== page) {
      // The old page becomes inert in this commit. Keep focus inside the newly active page,
      // including when the menu is docked and Radix is not managing its items. Radix
      // focuses the menu content after selection, so move focus after that has finished.
      const frame = requestAnimationFrame(() => (page === 'agents' ? backButton : configureButton).current?.focus());
      previousPage.current = page;
      return () => cancelAnimationFrame(frame);
    }
  }, [page]);
  const m = t.leftMenu;
  const drag = titlebar ? { 'data-tauri-drag-region': '' } : {};
  // an entry's action: in the dropdown the menu closes with the choice
  const run = (f: () => void) => f;
  const pin = (p.pinnable || p.pinned) && (
    <Act sidebarItem={false} className={cn('ml-auto grid size-[30px] cursor-pointer place-items-center rounded-[3px] border-0 bg-muted p-0 text-muted-foreground hover:text-foreground', p.pinned && 'text-foreground')} tip={p.pinned ? m.unpin : m.pin} aria-label={p.pinned ? m.unpin : m.pin} aria-pressed={p.pinned} onAct={() => p.onPin(!p.pinned)}>
      {p.pinned ? <PanelLeftClose size={16} strokeWidth={2} aria-hidden /> : <PanelLeft size={16} strokeWidth={2} aria-hidden />}
    </Act>
  );
  const inbox = (
    <Entry icon={<Inbox size={16} strokeWidth={2} aria-hidden />} label={m.inbox} on={p.showing === 'inbox'} onClick={run(p.onInbox)} />
  );
  return (
    // the menu's two pages side by side, the second ("Configure agents") sliding in over the first; the
    // page out of view takes no height, so the menu is as tall as the page it shows
    <div className={cn('grid grid-cols-[100%_100%] items-start transition-transform duration-300 ease-[cubic-bezier(.3,.9,.3,1)]', page === 'agents' && '-translate-x-full')}>
      <InMenu.Provider value={!floating ? null : page === 'main' ? ACTIVE : INACTIVE}>
      <div className={pageClass(page !== 'main')} inert={page !== 'main'}>
        {/* in the app on a Mac the traffic lights take the head; the inbox's entry follows under it */}
        <div className={head(titlebar)} {...drag}>
          {!titlebar && <NavList className={cn(list, 'min-w-0 flex-1')}>{inbox}</NavList>}
          {pin}
        </div>
        <NavList className={list}>
          {titlebar && inbox}
          <Entry icon={<Bot size={16} strokeWidth={2} aria-hidden />} label={m.configureAgents} focusRef={configureButton} keep onClick={() => setPage('agents')} end={<ChevronRight size={16} strokeWidth={2} className="ml-auto flex-none text-muted-foreground" aria-hidden />} />
        </NavList>
        <h3 className="mx-2.5 mt-4 mb-1.5 text-[12px] font-semibold tracking-[.04em] text-muted-foreground uppercase">{m.projects}</h3>
        <NavList className={list}>
          {p.projects.map((c) =>
            c.id === p.project.id ? (
              <li key={c.id}>
                <NavList className={list}>
                  <ProjectRow project={c} here bold />
                </NavList>
                <NavList className={tree}>
                  {p.canvases.map((v) => (
                    <Entry key={v.id} icon={<CanvasIcon canvas={v} size={15} />} label={v.name} sub on={!p.showing && v.id === p.canvas} onClick={run(() => p.onCanvas(v))} />
                  ))}
                  <Entry icon={<ListOrdered size={16} strokeWidth={2} aria-hidden />} label={m.queue} sub on={p.showing === 'queue'} onClick={run(p.onQueue)} />
                  <Entry icon={<Car size={16} strokeWidth={2} aria-hidden />} label={m.parked} sub on={p.showing === 'parked'} onClick={run(p.onParked)} />
                  <Entry icon={<Archive size={16} strokeWidth={2} aria-hidden />} label={m.archived} sub on={p.showing === 'archived'} onClick={run(p.onArchived)} />
                  <Entry icon={<SlidersHorizontal size={16} strokeWidth={2} aria-hidden />} label={m.projectSettings} sub on={p.showing === 'settings'} onClick={run(p.onProjectSettings)} end={<ChevronRight size={16} strokeWidth={2} className="ml-auto flex-none text-muted-foreground" aria-hidden />} />
                </NavList>
              </li>
            ) : (
              <ProjectRow key={c.id} project={c} here={false} />
            ),
          )}
          <NewProject onNew={run(p.onNew)} />
        </NavList>
        <NavList className={cn(list, 'mt-0.5 border-t border-border pt-2.5')}>
          <Entry icon={<Settings size={16} strokeWidth={2} aria-hidden />} label={m.settings} onClick={run(p.onConfig)} />
          <li>
            <NavList className={tree}>
              <Entry label={m.prefs} sub onClick={run(p.onPrefs)} />
              <Entry label={m.help} sub onClick={run(p.onHelp)} />
              <Entry label={t.wish.link} sub onClick={run(() => openWish())} />
            </NavList>
          </li>
        </NavList>
      </div>
      </InMenu.Provider>
      <InMenu.Provider value={!floating ? null : page === 'agents' ? ACTIVE : INACTIVE}>
      <div className={pageClass(page !== 'agents')} inert={page !== 'agents'}>
        <div className={head(titlebar)} {...drag}>
          <Act sidebarItem={false} className="-ml-0.5 flex h-8 cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-transparent px-2.5 text-[14px] text-foreground hover:bg-muted" ref={backButton} keep onAct={() => setPage('main')} tip={m.back} aria-label={m.back}>
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
            <b>{m.configureAgents}</b>
          </Act>
          {pin}
        </div>
        <NavList className={list}>
          <Entry icon={<Users size={16} strokeWidth={2} aria-hidden />} label={m.agents} soon />
          <Entry icon={<ScrollText size={16} strokeWidth={2} aria-hidden />} label={m.rules} soon />
          <Entry icon={<FileCheck size={16} strokeWidth={2} aria-hidden />} label={m.reviewRules} soon />
          <Entry icon={<ChartLine size={16} strokeWidth={2} aria-hidden />} label={m.performance} onClick={run(p.onPerformance)} />
          <li>
            <NavList className={tree}>
              <Entry label={m.feedbackLog} sub onClick={run(p.onFeedbackLog)} />
            </NavList>
          </li>
        </NavList>
      </div>
      </InMenu.Provider>
    </div>
  );
}

/** One of the menu's two pages; the one out of view hides once it has slid away, and takes no height. */
const pageClass = (away: boolean) => cn('min-w-0', away && 'invisible h-0 [transition:visibility_0s_.3s]');

/**
 * A page's head: the inbox's entry or the way back, and the pin. In the app on a Mac the window's
 * traffic lights sit in it, as tall as the bar; it stays put as the list scrolls under it (a sticky box
 * keeps clear of its scroller's padding, hence the negative top).
 */
const head = (titlebar?: boolean) =>
  cn(
    'mb-0.5 flex min-h-8 items-center gap-2.5',
    titlebar && 'sticky -top-3.5 z-1 -mx-3.5 -mt-3.5 h-[58px] bg-surface/88 pr-3.5 pl-[92px] backdrop-blur-[16px] reduced:bg-surface',
  );

/** A button of the menu: an item of the open dropdown, else a plain button. `keep` leaves the dropdown open. */
function Act({ onAct, keep, disabled, tip, sidebarItem = true, children, ...props }: { onAct?: (() => void) | undefined; keep?: boolean; disabled?: boolean; tip?: string; sidebarItem?: boolean } & Omit<ComponentProps<'button'>, 'onClick'>) {
  const menu = useContext(InMenu);
  if (!menu) {
    return (
      <Tooltip content={tip}>
        {sidebarItem ? <SidebarMenuButton asChild><button {...props} disabled={disabled} onClick={onAct}>{children}</button></SidebarMenuButton> : <button {...props} disabled={disabled} onClick={onAct}>{children}</button>}
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
          else leaveMenu();
          onAct?.();
        }}
      >
        <button {...props}>{children}</button>
      </MenuItem>
    </Tooltip>
  );
}

/** One of the menu's entries: an icon, its label and what stands at its end; greyed out with "Coming soon" while it opens nothing yet. */
function Entry({ icon, label, end, on, soon, sub, keep, onClick, focusRef }: { icon?: ReactNode; label: string; end?: ReactNode; on?: boolean; soon?: boolean; sub?: boolean; keep?: boolean; onClick?: () => void; focusRef?: Ref<HTMLButtonElement> }) {
  const menu = useContext(InMenu);
  const Item = menu ? 'li' : SidebarMenuItem;
  return (
    <Item>
      <Act
        ref={focusRef}
        className={cn(
          'box-border flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[14px] text-foreground outline-none hover:not-disabled:bg-muted focus-visible:bg-muted disabled:cursor-default disabled:text-muted-foreground disabled:opacity-60 data-highlighted:bg-muted [&>svg]:flex-none [&>svg]:text-muted-foreground',
          sub && 'min-h-[30px] py-[5px] text-[13px]',
          on && 'bg-muted font-semibold',
        )}
        aria-current={on || undefined}
        disabled={soon}
        title={soon ? t.leftMenu.comingSoon : undefined}
        keep={keep}
        onAct={onClick}
      >
        {icon}
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
        {soon ? <span className="ml-auto flex-none text-[12px]">{t.leftMenu.comingSoon}</span> : end}
      </Act>
    </Item>
  );
}

/** A project's row: a click switches there (the open one stays); its agents' pause. */
function ProjectRow({ project: c, here, repos, bold, onGo }: { project: ProjectInfo; here: boolean; repos?: boolean; bold?: boolean; onGo?: () => void }) {
  const menu = useContext(InMenu);
  const link = (
    <a
      className={cn(rowButton, here && 'bg-muted text-foreground', here && bold && 'font-semibold', c.agents && 'pr-[46px]')}
      href={projectPath(c.id)}
      aria-current={here ? 'page' : undefined}
      onClick={(e) => {
        onGo?.();
        // switchTo prevents the link's click. Radix then skips MenuItem's select/close,
        // so dismiss the dropdown explicitly before navigating within the page.
        if (menu && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          leaveMenu();
          closeBarMenus();
        }
        switchTo(e, projectPath(c.id));
      }}
    >
      <ProjectIcon />
      {/* a long name and its repositories shorten rather than wrap, the repositories first */}
      <b className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={c.name}>{c.name}</b>
      {repos && <span className="min-w-0 flex-[0_1000_auto] overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-muted-foreground">{c.repos.map((r) => r.name).join(', ')}</span>}
    </a>
  );
  return (
    <SidebarMenuItem data-row className="group/project relative [[data-row]+&]:mt-0.5">
      {menu ? <MenuItem asChild disabled={!menu.active} onSelect={leaveMenu}>{link}</MenuItem> : <SidebarMenuButton asChild>{link}</SidebarMenuButton>}
      <ProjectAgents project={c} item={menu} />
    </SidebarMenuItem>
  );
}

function NewProject({ onNew }: { onNew: () => void }) {
  const Item = useContext(InMenu) ? 'li' : SidebarMenuItem;
  return (
    <Item data-row className="[[data-row]+&]:mt-0.5">
      <Act className={cn(rowButton, 'hover:text-foreground data-highlighted:text-foreground')} onAct={onNew}>
        <Plus size={15} strokeWidth={2} aria-hidden />
        <b>{t.nav.newProject}</b>
      </Act>
    </Item>
  );
}

function ProjectIcon() {
  return <GitBranch size={15} strokeWidth={2} aria-hidden />;
}
