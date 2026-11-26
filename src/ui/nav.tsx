









import { Archive, ArrowLeft, Bot, Car, ChartLine, Check, ChevronDown, ChevronRight, Cog, FileCheck, Inbox, ListOrdered, Menu as Menu_, PanelLeft, PanelLeftClose, Plus, ScrollText, Settings, SlidersHorizontal, Users, X } from 'lucide-react';
import { type ComponentProps, createContext, type ReactNode, type Ref, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { Canvas, ProjectInfo } from '../core/types';
import { projectPath, switchTo } from './address';
import { CanvasIcon, ProjectIcon } from './canvasIcon';
import { Sign, Wordmark } from './logo';
import { InboxList, type InboxProps } from './inbox';
import { closeBarMenus, leaveMenu, Menu, MenuContent, MenuItem, MenuTrigger } from './components/menu';
import { ProjectAgents } from './parts';
import { switcherKeys, t } from './strings';
import { openWish } from './wish';
import { Tooltip } from './components/tooltip';
import { PillButton } from './components/pill';
import { cn } from 'cn';
import { Sidebar, SidebarContent, SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from './components/sidebar';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from './components/sheet';
import { DeskIcon } from './desks/page';
import { currentDesk, deskError, desks, openWorkspaces, useDesks } from './desks/shell';


const list = 'm-0 list-none p-0';

const tree = cn(list, 'mt-0.5 mb-1 pl-6');
const rowButton = 'flex w-full cursor-pointer items-center gap-2 rounded-sm bg-transparent px-2.5 py-1.5 text-left text-sm text-muted-foreground no-underline outline-none hover:bg-muted data-highlighted:bg-muted [&_svg]:flex-none';

const menuPanel = 'w-[min(360px,calc(100vw-28px))] rounded-lg border border-glass-edge px-3.5 pt-3.5 pb-4';


export const NAV_W = 256;
export const NAV_MIN_W = 240;
export const NAV_MAX_W = 460;

export const NAV_PROJECT_MIN = 480;
const WIDTH_KEY = 'seismic-nav-width';
const PIN_KEY = 'seismic-nav-pinned';

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
  
  onNew?: () => void;
  
  onProject?: (id: string) => void;
}

/** The floating row's switcher: the project's name, and under it the projects. */
export function NavPill(p: ProjectsProps) {
  const [open, setOpen] = useState(false);
  const home = p.project.repos[0];
  return (
    <Menu open={open} onOpenChange={setOpen}>
      { }
      <div className="relative flex-none group-data-[fit~='3']/row:min-w-0 group-data-[fit~='3']/row:flex-[0_1_auto]">
        <MenuTrigger asChild>
          <PillButton size="bar" on={open} className="group-data-[fit~='3']/row:max-w-full group-data-[fit~='3']/row:[&_b]:overflow-hidden group-data-[fit~='3']/row:[&_b]:text-ellipsis" title={t.nav.button}>
            <ProjectIcon icon={p.project.icon} />
            <b>{p.project.name}</b>
            <span className="text-xs text-muted-foreground group-data-[fit~='1']/row:hidden">{p.project.repos.length > 1 ? t.repos(p.project.repos.length) : home?.branch}</span>
            <ChevronDown size={12} strokeWidth={1.75} className="text-muted-foreground" aria-hidden="true" />
          </PillButton>
        </MenuTrigger>
      </div>
      <MenuContent className={menuPanel}>
        <InMenu.Provider value={ACTIVE}>
          <NavList className={list}>
            {p.projects.map((c) => (
              <ProjectRow key={c.id} project={c} here={c.id === p.project.id} repos onProject={p.onProject} />
            ))}
            {p.onNew && <NewProject onNew={p.onNew} />}
          </NavList>
        </InMenu.Provider>
        <SwitcherHint />
      </MenuContent>
    </Menu>
  );
}





const InMenu = createContext<{ active: boolean } | null>(null);
const ACTIVE = { active: true };
const INACTIVE = { active: false };

function NavList(props: ComponentProps<'ul'>) {
  return useContext(InMenu) ? <ul {...props} /> : <SidebarMenu {...props} className={cn('gap-0', props.className)} />;
}





export interface MenuActions {
  onInbox: () => void;
  
  inbox?: InboxProps;
  
  onAgents?: () => void;
  onRules?: () => void;
  onReviewRules?: () => void;
  onPerformance?: () => void;
  onFeedbackLog?: () => void;
  
  canvases: Canvas[];
  canvas?: string;
  onCanvas?: (c: Canvas) => void;
  onQueue?: () => void;
  onParked?: () => void;
  onArchived?: () => void;
  onProjectSettings: () => void;
  
  showing?: 'archived' | 'inbox' | 'parked' | 'queue' | 'settings';
  
  onConfig?: () => void;
  onPrefs?: () => void;
  onHelp?: () => void;
}

export interface MenuProps extends ProjectsProps, MenuActions {
  
  pinned: boolean;
  
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
      className="-ml-1.5 mr-1 flex h-[34px] cursor-pointer items-center gap-1 rounded-xs bg-transparent px-1.5 text-foreground hover:bg-foreground/7 data-[on]:bg-foreground/7"
      aria-label={t.leftMenu.button}
      aria-expanded={docked ? dockedOn : undefined}
      onClick={docked ? () => onDocked(!dockedOn) : undefined}
    >
      <Menu_ className="mr-1 block flex-none" size={18} strokeWidth={2} aria-hidden />
      { }
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
        { }
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
  
  const titlebar = window.seismicApp?.platform === 'macos';
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
        <SidebarContent className="px-3.5 pt-3.5 pb-8">
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
          className="group/resize absolute inset-y-0 -right-1.5 z-40 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
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

/**
 * The same menu on the phone, behind the logo at the top left: a sheet over the whole screen from
 * the left, with the entries the phone has a view for (the actions given), a tap closing it.
 */
export function PhoneNavSheet({ open, onOpenChange, ...p }: MenuProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} className="ph-menu w-full max-w-none gap-0 overflow-y-auto border-0 px-[max(14px,env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none" aria-describedby={undefined}>
        <SheetDescription className="sr-only">{t.leftMenu.button}</SheetDescription>
        <div className="flex min-h-14 items-center gap-2.5">
          <Sign size={26} />
          <SheetTitle className="min-w-0 flex-1 text-xl">{t.phone.next.menuTitle}</SheetTitle>
          <SheetClose className="inline-grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-muted p-0 text-foreground" aria-label={t.phone.next.closeMenu}>
            <X size={20} strokeWidth={2.25} aria-hidden="true" />
          </SheetClose>
        </div>
        { }
        <SidebarProvider open className="contents text-lg [&_[data-sidebar=menu-button]]:min-h-11 [&_[data-sidebar=menu-button]]:text-base">
          <MenuBody {...p} phone />
        </SidebarProvider>
      </SheetContent>
    </Sheet>
  );
}

/** The menu's two pages, the main one and "Configure agents", the second sliding in over the first. */
function MenuBody({ floating, titlebar, phone, ...p }: MenuProps & { floating?: boolean; titlebar?: boolean; phone?: boolean }) {
  const [page, setPage] = useState<'main' | 'agents' | 'inbox'>('main');
  const previousPage = useRef(page);
  const configureButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const inboxBackButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (previousPage.current !== page) {
      
      
      
      const frame = requestAnimationFrame(() => (page === 'main' ? configureButton : page === 'agents' ? backButton : inboxBackButton).current?.focus());
      previousPage.current = page;
      return () => cancelAnimationFrame(frame);
    }
  }, [page]);
  const m = t.leftMenu;
  const drag = titlebar ? { 'data-tauri-drag-region': '' } : {};
  
  const run = (f: () => void) => f;
  const pin = (p.pinnable || p.pinned) && (
    <Act sidebarItem={false} className={cn('ml-auto grid size-[30px] cursor-pointer place-items-center rounded-xs bg-muted p-0 text-muted-foreground hover:text-foreground', p.pinned && 'text-foreground')} tip={p.pinned ? m.unpin : m.pin} aria-label={p.pinned ? m.unpin : m.pin} aria-pressed={p.pinned} onAct={() => p.onPin(!p.pinned)}>
      {p.pinned ? <PanelLeftClose size={16} strokeWidth={2} aria-hidden /> : <PanelLeft size={16} strokeWidth={2} aria-hidden />}
    </Act>
  );
  
  const soon = !!p.onConfig;
  const agentEntries = [
    { icon: <Users size={16} strokeWidth={2} aria-hidden />, label: m.agents, onClick: p.onAgents },
    { icon: <ScrollText size={16} strokeWidth={2} aria-hidden />, label: m.rules, onClick: p.onRules },
    { icon: <FileCheck size={16} strokeWidth={2} aria-hidden />, label: m.reviewRules, onClick: p.onReviewRules },
  ].filter((e) => e.onClick || soon);
  
  const hasAgentsPage = agentEntries.length > 0 || !!p.onPerformance || !!p.onFeedbackLog;
  const inbox = (
    <Entry icon={<Inbox size={16} strokeWidth={2} aria-hidden />} label={m.inbox} on={p.showing === 'inbox'} keep={!!p.inbox} onClick={p.inbox ? () => setPage('inbox') : run(p.onInbox)} />
  );
  return (
    
    
    <div className={cn('grid grid-cols-[100%_100%_100%] items-start transition-transform duration-300 ease-[cubic-bezier(.3,.9,.3,1)]', page === 'agents' && '-translate-x-full', page === 'inbox' && '-translate-x-[200%]')}>
      <InMenu.Provider value={!floating ? null : page === 'main' ? ACTIVE : INACTIVE}>
      <div className={pageClass(page !== 'main')} inert={page !== 'main'}>
        {!phone && !titlebar && <DeskSwitcher />}
        <div className={head(titlebar)} {...drag}>
          {!titlebar && <NavList className={cn(list, 'min-w-0 flex-1')}>{inbox}</NavList>}
          {pin}
        </div>
        {!phone && titlebar && <DeskSwitcher />}
        <NavList className={list}>
          {titlebar && inbox}
          {hasAgentsPage && <Entry icon={<Bot size={16} strokeWidth={2} aria-hidden />} label={m.configureAgents} focusRef={configureButton} keep onClick={() => setPage('agents')} end={<ChevronRight size={16} strokeWidth={2} className="ml-auto flex-none text-muted-foreground" aria-hidden />} />}
        </NavList>
        <h3 className="mx-2.5 mt-4 mb-1.5 text-xs font-semibold tracking-[.04em] text-muted-foreground uppercase">{m.projects}</h3>
        <NavList className={list}>
          {p.projects.map((c) =>
            c.id === p.project.id ? (
              <li key={c.id}>
                <NavList className={list}>
                  <ProjectRow project={c} here bold onProject={p.onProject} />
                </NavList>
                <NavList className={tree}>
                  {p.onCanvas && p.canvases.map((v) => (
                    <Entry key={v.id} icon={<CanvasIcon canvas={v} size={15} />} label={v.name} sub on={!p.showing && v.id === p.canvas} onClick={run(() => p.onCanvas!(v))} />
                  ))}
                  {p.onQueue && <Entry icon={<ListOrdered size={16} strokeWidth={2} aria-hidden />} label={m.queue} sub on={p.showing === 'queue'} onClick={run(p.onQueue)} />}
                  {p.onParked && <Entry icon={<Car size={16} strokeWidth={2} aria-hidden />} label={m.parked} sub on={p.showing === 'parked'} onClick={run(p.onParked)} />}
                  {p.onArchived && <Entry icon={<Archive size={16} strokeWidth={2} aria-hidden />} label={m.archived} sub on={p.showing === 'archived'} onClick={run(p.onArchived)} />}
                  <Entry icon={<SlidersHorizontal size={16} strokeWidth={2} aria-hidden />} label={m.projectSettings} sub on={p.showing === 'settings'} onClick={run(p.onProjectSettings)} end={<ChevronRight size={16} strokeWidth={2} className="ml-auto flex-none text-muted-foreground" aria-hidden />} />
                </NavList>
              </li>
            ) : (
              <ProjectRow key={c.id} project={c} here={false} onProject={p.onProject} />
            ),
          )}
          {p.onNew && <NewProject onNew={p.onNew} />}
        </NavList>
        { }
        {p.onConfig && <SwitcherHint className="mb-2" />}
        {p.onConfig && (
          <NavList className={cn(list, 'mt-0.5 border-t border-border pt-2.5')}>
            <Entry icon={<Settings size={16} strokeWidth={2} aria-hidden />} label={m.settings} onClick={run(p.onConfig)} />
            <li>
              <NavList className={tree}>
                {p.onPrefs && <Entry label={m.prefs} sub onClick={run(p.onPrefs)} />}
                {p.onHelp && <Entry label={m.help} sub onClick={run(p.onHelp)} />}
                <Entry label={t.wish.link} sub onClick={run(() => openWish())} />
              </NavList>
            </li>
          </NavList>
        )}
      </div>
      </InMenu.Provider>
      <InMenu.Provider value={!floating ? null : page === 'agents' ? ACTIVE : INACTIVE}>
      <div className={pageClass(page !== 'agents')} inert={page !== 'agents'}>
        <div className={head(titlebar)} {...drag}>
          <Act sidebarItem={false} className="-ml-0.5 flex h-8 cursor-pointer items-center gap-2 rounded-sm bg-transparent px-2.5 text-base text-foreground hover:bg-muted" ref={backButton} keep onAct={() => setPage('main')} tip={m.back} aria-label={m.back}>
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
            <b>{m.configureAgents}</b>
          </Act>
          {pin}
        </div>
        <NavList className={list}>
          {agentEntries.map((e) => <Entry key={e.label} icon={e.icon} label={e.label} soon={!e.onClick} {...(e.onClick ? { onClick: run(e.onClick) } : {})} />)}
          {p.onPerformance && <Entry icon={<ChartLine size={16} strokeWidth={2} aria-hidden />} label={m.performance} onClick={run(p.onPerformance)} />}
          {p.onFeedbackLog && (
            <li>
              <NavList className={tree}>
                <Entry label={m.feedbackLog} sub onClick={run(p.onFeedbackLog)} />
              </NavList>
            </li>
          )}
        </NavList>
      </div>
      </InMenu.Provider>
      <InMenu.Provider value={!floating ? null : page === 'inbox' ? ACTIVE : INACTIVE}>
      { }
      <div className={pageClass(page !== 'inbox')} inert={page !== 'inbox'} onKeyDown={floating ? (e) => { if (e.key !== 'Escape') e.stopPropagation(); } : undefined}>
        <div className={head(titlebar)} {...drag}>
          <Act sidebarItem={false} className="-ml-0.5 flex h-8 cursor-pointer items-center gap-2 rounded-sm bg-transparent px-2.5 text-base text-foreground hover:bg-muted" ref={inboxBackButton} keep onAct={() => setPage('main')} tip={m.back} aria-label={m.back}>
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
            <b>{m.inbox}</b>
          </Act>
          {pin}
        </div>
        { }
        {p.inbox && page === 'inbox' && (
          <InboxList {...p.inbox} onGo={(e) => { if (floating) leaveMenu(); p.inbox!.onGo(e); }} />
        )}
      </div>
      </InMenu.Provider>
    </div>
  );
}

/**
 * The workspace switcher, in the desktop app alone: the workspace the window shows (its name, this
 * machine or remote), a click away from the others and "New workspace"; its cog opens that
 * workspace's dialog on this machine's workspaces page.
 */
function DeskSwitcher() {
  const all = useDesks();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState('');
  const shown = currentDesk(all);
  if (!all || !shown) return null;
  const w = t.desks;
  const failed = (about = '') => (e: unknown) => setProblem(deskError(e, about));
  const toggle = () => (setOpen(!open), setProblem(''));
  return (
    <div className="desk-switcher mt-1 mb-2 rounded-md border border-border">
      <div className="grid grid-cols-[1fr_auto] p-1">
        <Act sidebarItem={false} keep className={cn(rowButton, 'col-start-1 col-end-3 row-start-1 row-end-3 grid grid-rows-subgrid gap-0 px-2 py-0 text-foreground')} tip={w.switcher} aria-expanded={open} onAct={toggle}>
          <span className="flex items-start gap-2 pt-1.5">
            <span className="mt-0.5 flex-none"><DeskIcon desk={shown} size={15} /></span>
            <b className="min-w-0 flex-1 [overflow-wrap:anywhere]">{shown.name}</b>
            <ChevronDown size={14} strokeWidth={2} className={cn('mt-1 ml-auto text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
          </span>
          <span className="flex items-center pl-6 text-xs text-muted-foreground">{shown.local ? w.thisMachine : w.remote}</span>
        </Act>
        <Act sidebarItem={false} className="relative col-start-2 row-start-2 mr-2 grid size-7 cursor-pointer place-items-center self-center rounded-xs bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground data-highlighted:bg-muted" tip={w.settings} aria-label={w.settings} onAct={() => void openWorkspaces(all, `?edit=${encodeURIComponent(shown.id)}`).catch(failed())}>
          <Cog size={16} strokeWidth={2} aria-hidden />
        </Act>
      </div>
      {open && (
        <NavList className={cn(list, 'border-t border-border p-1')}>
          {all.list.map((d) => (
            <Entry
              key={d.id}
              sub
              keep={d.id === shown.id}
              icon={<DeskIcon desk={d} size={15} />}
              label={d.name}
              on={d.id === shown.id}
              end={<span className="ml-auto flex flex-none items-center gap-1.5 text-xs text-muted-foreground">{d.local ? w.thisMachine : w.remote}{d.id === shown.id ? <Check size={14} strokeWidth={2.25} aria-hidden /> : <span className="w-3.5" />}</span>}
              onClick={() => d.id !== shown.id && void desks.open(d.id).catch(failed(d.origin ?? ''))}
            />
          ))}
          <Entry sub icon={<Plus size={15} strokeWidth={2} aria-hidden />} label={w.newDesk} onClick={() => void openWorkspaces(all, '?new').catch(failed())} />
        </NavList>
      )}
      {problem && <p role="alert" className="m-0 px-2.5 pb-2 text-xs text-destructive [overflow-wrap:anywhere]">{problem}</p>}
    </div>
  );
}

/** One of the menu's pages; the one out of view hides once it has slid away, and takes no height. */
const pageClass = (away: boolean) => cn('min-w-0', away && 'invisible h-0 [transition:visibility_0s_.3s]');

/**
 * A page's head: the inbox's entry or the way back, and the pin. In the app on a Mac the window's
 * traffic lights sit in it, as tall as the bar; it stays put as the list scrolls under it (a sticky box
 * keeps clear of its scroller's padding, hence the negative top).
 */
const head = (titlebar?: boolean) =>
  cn(
    'mb-0.5 flex min-h-8 items-center gap-2.5',
    titlebar && 'sticky -top-3.5 z-1 -mx-3.5 -mt-3.5 h-[50px] bg-surface/88 pr-3.5 pl-23 backdrop-blur-[16px] reduced:bg-surface',
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
          'box-border flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-sm bg-transparent px-2.5 py-1.5 text-left text-base text-foreground outline-none hover:not-disabled:bg-muted focus-visible:bg-muted disabled:cursor-default disabled:text-muted-foreground disabled:opacity-60 data-highlighted:bg-muted [&>svg]:flex-none [&>svg]:text-muted-foreground',
          sub && 'min-h-[30px] py-1 text-sm',
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
        {soon ? <span className="ml-auto flex-none text-xs">{t.leftMenu.comingSoon}</span> : end}
      </Act>
    </Item>
  );
}

/** A project's row: a click switches there (the open one stays); its agents' pause. */
function ProjectRow({ project: c, here, repos, bold, onGo, onProject }: { project: ProjectInfo; here: boolean; repos?: boolean; bold?: boolean; onGo?: () => void; onProject?: ((id: string) => void) | undefined }) {
  const menu = useContext(InMenu);
  const link = (
    <a
      className={cn(rowButton, here && 'bg-muted text-foreground', here && bold && 'font-semibold', c.agents && 'pr-12')}
      href={projectPath(c.id)}
      aria-current={here ? 'page' : undefined}
      onClick={(e) => {
        onGo?.();
        
        
        if (menu && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          leaveMenu();
          closeBarMenus();
        }
        if (onProject) {
          e.preventDefault();
          onProject(c.id);
        } else switchTo(e, projectPath(c.id));
      }}
    >
      <ProjectIcon icon={c.icon} />
      { }
      <b className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={c.name}>{c.name}</b>
      {repos && <span className="min-w-0 flex-[0_1000_auto] overflow-hidden text-xs text-ellipsis whitespace-nowrap text-muted-foreground">{c.repos.map((r) => r.name).join(', ')}</span>}
    </a>
  );
  return (
    <SidebarMenuItem data-row className="group/project relative [[data-row]+&]:mt-0.5">
      {menu ? <MenuItem asChild disabled={!menu.active} onSelect={leaveMenu}>{link}</MenuItem> : <SidebarMenuButton asChild>{link}</SidebarMenuButton>}
      <ProjectAgents project={c} item={menu} />
    </SidebarMenuItem>
  );
}

/** Under a list of the projects: the key of the quick project switcher (projectSwitcher.tsx), so it is found. */
function SwitcherHint({ className }: { className?: string }) {
  return (
    <p className={cn('mt-2 mb-0 flex items-center gap-1.5 px-2.5 text-xs text-muted-foreground', className)}>
      <kbd className="grid h-5 place-items-center rounded-xs border border-border px-1 font-mono text-xs">{switcherKeys()}</kbd>
      {t.projectSwitcher.hint}
    </p>
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
