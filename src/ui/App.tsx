import { draftSession, onHandOverEntries } from './draftSession';
import { activeMergeCard } from '../core/merge';
import { FullPageHost, useFullPage } from './fullPage';
import { DockShell, useDock, type DockView } from './dockViews';
import { clientExtensions as extensions } from '../extensions/client';


import { useRatePrompt } from './feedback';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Bot, CircleUserRound, ConciergeBell, MessageSquare, FileText, Columns3, type LucideIcon, SlidersHorizontal, Trash2 } from 'lucide-react';
import { type Bounds, boundsOf, CARD_SIZE, centre, onProject, type Place, PLAN_HEAD, PLAN_PAD, unionBounds } from '../core/layout';
import { type RightClick, type Canvas, canvasNamedBy, MAIN_CANVAS, type ProjectInfo, type ProjectSnapshot, type CardPatch, type ConfigProblem, finished, type Group, type Item, nameless, withPart, needsYou, openPerGroup, type PendingRestart, type PlanDir, EVICT_HOLD_MS, START_ALL_HOLD_MS, titleFrom, type AppUpdate, type SourceUpdate, unreadAnswers, unreadPerPlan, type Usage, type Waiting, waitingIn, offCanvas } from '../core/types';
import { NotifyAsk, useDesktopNotifications } from './desktopNotify';
import { api, ApiError, beforeReload, cardsOn, onNotice, quietAtStart, reportFocus, setProject, useProject } from './api';
import { groupAt, GroupNames, growFrom, hintBubbleClass, inside, Lasso, MarkHint, Marked, Ring, TerritoryLayer, useTerritories } from './groups';
import { depLayerClass, handleColour, manualRemoveClass } from './depsClasses';
import { buzz, pinchCam, TOUCH_HOLD_KNOWN, Touches } from './touch';
import { besideSheet, BOTTOM, type Cam, camFor, camKey, centreOn, chase, dragLimit, edgeScroll, FAR, flying, flyTo, keepInView, lastCanvas, lastCanvasKey, MAX_ZOOM, midX, MIN_ZOOM, NO_SIDES, overviewCam, placeIn, shows, type Sides, stopFlight, TOP, toWorld } from './camera';
import { plain } from './markdown';
import { CanvasRing, Canvases, CanvasStubs, CanvasTabs, CardMore, hiddenCard, parkedStubsOf, stubsOf } from './canvases';
import { canvasText } from './canvasIcon';
import { clip } from '../core/text';
import { type ActDone, Detail, type Pending } from './detail';
import { Cards, KoordinatorAgent } from './message';
import { motionMs, reducedMotion, sizeSettled } from './motion';
import type { Heard, Where } from './api';
import { actCard, archiveCard, dequeueCard, getAgentModels, patchCard, removeCard, restoreCard, startCardAgent, unarchiveCard } from './clients/seismic';
import { replyOn, setReply } from './reply';
import { ArchiveView } from './archive';
import { CardSearch } from './cardSearch';
import { useBarFit } from './barFit';
import { UsagePill } from './usage';
import { ConfigDialog, ConfigurationProblems, Problem, showAddSite, showDevicesSection } from './config';
import { PrefsDialog } from './prefs';
import { PhoneDialog } from './access';
import { OpenPerformance, PerformanceDialog } from './performance';
import { FeedbackLog } from './feedbackLog';
import { LOG_KEYS, readLogQuery } from '../core/feedback-log';
import { Setup } from './views/setup';
import { WorkspacesPage } from './desks/page';
import { inApp, WORKSPACES_PATH } from './desks/shell';
import { phoneView } from './phoneEnvironment';
import { PhoneNext } from './phoneNext';
import { KoordinatorSheet } from './koordinator';
import { closeBarMenus } from './components/menu';
import { ConfirmDialog } from './components/dialog';
import { forcedText } from './queue';
import { queueOrder } from '../core/queue';
import { AgentsSheet } from './agents';
import { TableView } from './table/view';
import { ParkedView, QueueView, type SwitchedView, ViewSwitcher } from './views';
import { depsOf, handleAt, manualPrerequisites, nearestHandle, settledAmong, type Side, waitsAmong, withoutImplied } from './deps';
import { anchoredPath, nearestEdge } from './manualLinks';
import type { ManualAnchor } from '../core/types';
import { collect, keep, keptKey, type Kept, leaveSheet, restore, sheetKey, type SideSheet, takeKept, takeSheetLeft } from './keep';
import { Sign } from './logo';
import { Help, HelpButton, HELP_KEY_KNOWN } from './help';
import { know, known } from './known';
import { addAll, MARK_KNOWN, markable, MOVE_MARKED_KNOWN, movesWith, shifted, toggle } from './selection';
import { closeWish, keepWish, openWish, useWish, WishDialog } from './wish';
import { PlanDirNote, planDirBoxes, useHiddenEmptyNotes } from './planDirs';
import { pastedShots } from './pasteHint';
import { attachTo, imageFiles } from './shots';
import { cardDraft, drafted, fieldOn, focusedDraft, keepDrafts, MIC_DRAFT, SEISMIC_DRAFT, takesImages } from './draft';
import { HoldToTalk, PushToTalk, SPACE_SHOWS_MS, TAP_MS, usePushToTalk, useTold } from './voice';
import { acksClass, Toasts, useToasts } from './components/toast';
import { layerOpen } from './components/ui';
import { videoOf } from './spot';
import { cardHooks, shownState, stateVars } from './card';
import { CardHandles, CardView, DepLinks, depHead, depWidth, linkPath, linkSpot, Edges, Links, Minimap, minimapArea, OldBunPill, PlanView, RestartPill, Sheet, SourcePill, TalkIcon, UpdatePill, WorkstationsPill } from './parts';
import { clock, failText, t } from './strings';
import { ProjectSwitcher, useSwitcherFeed, waitingPerProject } from './projectSwitcher';
import { loadNavHidden, loadNavWidth, loadPinned, MenuButton, NAV_PROJECT_MIN, NavPill, NavSheet, saveNavHidden, saveNavWidth, savePinned } from './nav';
import { projectPath, cardPath, feedbackLogPath, followedPath, goTo, cameByGoTo, named, knowProjects, projectNamed, queryWithout, readAddress, readView, withView, followedView } from './address';
import { type QuickReply, sendReply } from './quickReply';
import { NeedsYouSheet } from './needsYou';
import { useInboxRead } from './inboxRead';
import { ProjectSettingsSheet } from './projectSettings/sheet';
import { NewProjectDialog } from './projectSettings/project';
import { sectionOfSetting, type SettingsFocus, settingsFocusWaits, showSettingsAt } from './projectSettings/focus';
import { leave } from './leaving';
import { type InboxEntry, inboxEntries, needsYouCount, readMark } from '../core/inbox';
import { beingWritten, split, talkAlone } from './talk';
import { ACK_MS, noticeLine, tellers, useAck, useWarnings, voiceTarget } from './tell';
import { Tooltip } from './components/tooltip';
import { Badge } from './components/badge';
import { PillButton } from './components/pill';
import { cn } from 'cn';

export function App() {
  const [phone] = useState(phoneView);
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const refreshProjects = useCallback((list: ProjectInfo[], previous: ProjectInfo[]) => {
    
    setProjects((current) => current === previous ? list : current);
  }, []);
  const [failed, setFailed] = useState(false);
  
  const [, followed] = useState(0);
  useEffect(() => {
    if (phone) return;
    const on = () => followed((n) => n + 1);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  useEffect(() => {
    api.projects().then(
      (list) => {
        setProjects(list);
        if (phone) keepProjects(list);
      },
      () => {
        setFailed(true);
        if (phone) setProjects((c) => c ?? keptProjects());
      },
    );
    
    if (!phone) return;
    const h = setTimeout(() => setProjects((c) => c ?? keptProjects()), quietAtStart ? 0 : 3000);
    return () => clearTimeout(h);
  }, []);
  
  if (!phone && inApp() && location.pathname === WORKSPACES_PATH) return <WorkspacesPage key={location.search} />;
  if (!projects) return <Splash offline={failed} />;
  
  const { project: wanted, page } = readAddress();
  knowProjects(projects);
  
  const current = wanted ? projectNamed(projects, wanted) : projects[0];
  if (!projects.length) return <NoProject />;
  
  if (phone && current) return <PhoneNext projects={projects} />;
  return (
    <>
      {!current ? (
        <NoSuchProject name={wanted!} projects={projects} />
      ) : page === 'feedback' ? (
        
        <FeedbackLog projects={projects} here={current.id} />
      ) : (
        <Shown id={current.id} projects={projects} onProjects={setProjects} />
      )}
      { }
      <ProjectSwitcher project={current?.id ?? ''} projects={projects} onProjects={refreshProjects} />
    </>
  );
}

/**
 * The project `id`, which another takes the place of in the page when the owner switches: the one
 * shown before goes first (what it writes down as it goes, its drafts, still under its own name),
 * then the page's drafts and calls turn to the new one, which loads as on a page load.
 */
function Shown({ id, projects, onProjects }: { id: string; projects: ProjectInfo[]; onProjects: (list: ProjectInfo[]) => void }) {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    setProject(id);
    keepDrafts(draftSession, id);
    keepWish(draftSession, id);
    setReady(id);
  }, [id]);
  if (ready !== id) return <Splash offline={false} />;
  return <Live key={id} projects={projects} onProjects={onProjects} />;
}


const splash = 'fixed inset-0 flex flex-col items-center justify-center gap-3.5 text-muted-foreground animate-[fade_.3s_ease-out]';

const splashNoneRuns = 'p-6 text-foreground [&_.c-problem]:max-w-[640px]';

/** An address names a project that does not exist (a renamed one's old address, a typo): the projects there are, as links. */
function NoSuchProject({ name, projects }: { name: string; projects: ProjectInfo[] }) {
  return (
    <div id="splash" className={cn(splash, splashNoneRuns)}>
      <Sign size={56} />
      <h2 className="m-0">{t.noSuchProject(name)}</h2>
      <ul>
        {projects.map((c) => (
          <li key={c.id}>
            <a className="link card-link" href={projectPath(c.id)}>
              {c.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * No project runs: on the first start, with none configured yet, the setup assistant fills the page
 * and creates one; where the configured ones did not start, the page says why, and "Try again"
 * opens the projects once one runs.
 */
function NoProject() {
  const [problems, setProblems] = useState<ConfigProblem[] | null>(null);
  const read = () => api.configCheck().then((c) => setProblems(c.problems), () => setProblems([]));
  useEffect(() => void read(), []);
  if (!problems) return <Splash offline={false} />;
  const down = problems.filter((p) => p.code === 'projectDown');
  const globals = problems.filter((p) => p.project === undefined);
  if (!down.length && !globals.some((p) => p.code === 'invalid')) {
    return <Setup first notice={<ConfigurationProblems problems={globals.filter((p) => p.code !== 'noProject')} />} />;
  }
  const retried = () =>
    void api.projects().then((list) => {
      if (list.length) location.reload();
      else void read();
    }, console.error);
  return (
    <div id="splash" className={cn(splash, splashNoneRuns)}>
      <Sign size={56} />
      <h2 className="m-0">{t.noneRuns}</h2>
      <ConfigurationProblems problems={globals} retried={retried} />
      {down.map((p, k) => (
        <Problem key={k} problem={p} where="" retried={retried} />
      ))}
    </div>
  );
}



const KEPT_PROJECTS = 'seismic-phone-projects';

const DEP_KNOWN = 'seismic-dep-known';

const NEEDS_YOU_KNOWN = 'seismic-needs-you-known';
/** The keyboard's focus is on a control, reached by Tab rather than left there by a click: Tab goes on from it, as anywhere. */
const onControl = (t: EventTarget | null) => t instanceof HTMLElement && t !== document.body && t.matches(':focus-visible');
function keepProjects(list: ProjectInfo[]) {
  try {
    localStorage.setItem(KEPT_PROJECTS, JSON.stringify(list));
  } catch {}
}
function keptProjects(): ProjectInfo[] | null {
  try {
    const list = JSON.parse(localStorage.getItem(KEPT_PROJECTS) ?? 'null') as ProjectInfo[] | null;
    return list?.length ? list : null;
  } catch {
    return null;
  }
}


const UNRESPONSIVE_MS = 150_000;

/** The status bar when the server does not answer: retrying, or, after 2½ minutes, since when. */
function ConnectionLost({ since, frozen }: { since: number | null; frozen: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  const long = since !== null && Date.now() - since >= UNRESPONSIVE_MS;
  const text = frozen
    ? long ? t.unresponsiveSince(clock(since!)) : t.notResponding
    : long ? t.noConnectionSince(clock(since!)) : t.reconnecting;
  return <span className={cn(statusWord, 'text-waiting-strong')}>{text}</span>;
}

function Splash({ offline }: { offline: boolean }) {
  return (
    <div id="splash" className={splash}>
      <Sign size={56} />
      {offline && <div>{t.offline}</div>}
    </div>
  );
}

function Live({ projects: loaded, onProjects }: { projects: ProjectInfo[]; onProjects: (list: ProjectInfo[]) => void }) {
  const { snapshot, online, frozenSince, offlineSince, restart, update, source, usage, waiting, oldBun, projects } = useProject();
  
  useEffect(() => void (projects && onProjects(projects)), [projects]);
  
  useSwitcherFeed(!snapshot && Object.keys(waiting).length ? waitingPerProject(inboxEntries(projects ?? loaded, waiting)) : null);
  if (!snapshot) return <Splash offline={!online} />;
  
  return <Project snapshot={snapshot} online={online} downSince={offlineSince ?? frozenSince} frozen={frozenSince !== null} restart={restart} update={update} source={source} usage={usage} projects={projects ?? loaded} waiting={waiting} oldBun={oldBun} />;
}


type Focus = { type: 'plan'; id: string; prevCam: Cam; prevSide: Sides } | { type: 'card'; id: string; prevCam: Cam; prevSide: Sides; plan: Focus | null };
type Pos = { x: number; y: number };


const FLY_MS = 130;

const MARKED_ROOM = 90;
const MARKED_W = 270;
const UNFOLD_MS = 170;

const SETTLE_QUIET_MS = 100;
const SETTLE_CAP_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** What `get` returns once it returns something, within `ms`. */
async function soon<T>(get: () => T | undefined, ms = 3000): Promise<T | undefined> {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(100)) {
    const v = get();
    if (v) return v;
  }
  return get();
}



function Project({
  snapshot,
  online,
  downSince,
  frozen,
  restart,
  update,
  source,
  usage,
  projects,
  waiting,
  oldBun,
}: {
  snapshot: ProjectSnapshot;
  online: boolean;
  
  downSince: number | null;
  frozen: boolean;
  restart: PendingRestart | null;
  update: AppUpdate | null;
  source: SourceUpdate | null;
  
  usage: Usage[];
  projects: ProjectInfo[];
  waiting: Record<string, Waiting>;
  
  oldBun: string | null;
}) {
  knowProjects(projects);
  
  cardsOn(snapshot.project.id, snapshot.items.map((i) => i.id));
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  
  const shownAt = useRef<{ id: string; path: string } | null>(null);
  useEffect(() => {
    const to = followedPath(location.pathname, projects, snapshot.project.id, shownAt.current);
    shownAt.current = { id: snapshot.project.id, path: projectPath(snapshot.project.id) };
    if (to) history.replaceState(history.state, '', `${to}${location.search}${location.hash}`);
  }, [projects, snapshot.project.id]);
  
  
  const [moved, setMoved] = useState<Record<string, Pos>>({});
  
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  
  const [pending, setPending] = useState<Item[]>([]);
  
  const [underway, setUnderway] = useState<Record<string, string>>({});
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useEffect(() => {
    const byId = new Map(snapshot.items.map((i) => [i.id, i]));
    setMoved((m) => {
      const keep = Object.entries(m).filter(([id, p]) => {
        const i = byId.get(id);
        const d = dragRef.current;
        return i && (d?.id === id || d?.with.some((w) => w.id === id) || i.x !== p.x || i.y !== p.y);
      });
      return keep.length === Object.keys(m).length ? m : Object.fromEntries(keep);
    });
    setFolded((f) => {
      const keep = Object.entries(f).filter(([id, c]) => byId.has(id) && !!byId.get(id)!.plan?.collapsed !== c);
      return keep.length === Object.keys(f).length ? f : Object.fromEntries(keep);
    });
    setPending((p) => (p.some((i) => byId.has(i.id)) ? p.filter((i) => !byId.has(i.id)) : p));
    
    const elsewhere = (id: string) => Object.entries(waiting).find(([c]) => c !== snapshot.project.id && waiting[c]!.items.some((i) => i.id === id))?.[1].items.find((i) => i.id === id);
    setUnderway((u) => {
      const keep = Object.entries(u).filter(([id]) => {
        const i = byId.get(id) ?? elsewhere(id);
        return !!i && (i.state === 'waiting' || needsYou(i));
      });
      return keep.length === Object.keys(u).length ? u : Object.fromEntries(keep);
    });
  }, [snapshot, waiting]);

  const items = useMemo((): Item[] => {
    
    const ids = new Set(snapshot.items.map((i) => i.id));
    const all = [...snapshot.items, ...pending.filter((i) => !ids.has(i.id))];
    return all.map((i) => {
      const at = moved[i.id] ? { ...i, ...moved[i.id] } : i;
      const c = folded[i.id];
      if (c === undefined) return at;
      return withPart(at, 'plan', { collapsed: c || undefined });
    });
  }, [snapshot.items, pending, moved, folded]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  
  
  
  const [hash, setHash] = useState(() => location.hash);
  
  
  
  const keptCanvas = useRef<string | null | undefined>(undefined);
  if (keptCanvas.current === undefined) {
    try {
      keptCanvas.current = localStorage.getItem(lastCanvasKey(snapshot.project.id));
    } catch {
      keptCanvas.current = null;
    }
  }
  /**
   * Whether the address still names this project. Back or Forward to another project changes the
   * address before this one leaves the page (its `hashchange` can come first): what it names then is
   * the other project's, no choice here.
   */
  const addressOurs = () => {
    
    const a = readAddress().project;
    return (a ? projectNamed(projectsRef.current, a) : projectsRef.current[0])?.id === snapshotRef.current.project.id;
  };
  /** Keeps `id` as the canvas shown last on this project, for the next visit. */
  const keepCanvas = (id: string) => {
    if (gone.current || !addressOurs()) return;
    try {
      localStorage.setItem(lastCanvasKey(snapshot.project.id), id);
    } catch {}
  };
  
  
  
  
  const chosen = useRef<string>(undefined);
  const choose = (id: string) => {
    chosen.current = id === canvasRef.current ? undefined : id;
    if (id === canvasRef.current) keepCanvas(id);
  };
  
  const restoring = useRef(false);
  useEffect(() => {
    const on = () => {
      
      if (gone.current || !addressOurs()) return;
      
      const f = focusRef.current;
      const open = f?.type === 'card' ? itemsRef.current.find((i) => i.id === f.id) : undefined;
      const own = open && !open.archivedAt ? canvasesRef.current.find((c) => c.id === open.canvas) : undefined;
      const named = canvasNamedBy(canvasesRef.current, location.hash);
      
      if (own && named?.id !== own.id) {
        lastShown.current = own.id;
        history.replaceState(history.state, '', `${location.pathname}${location.search}`);
      }
      
      
      else if (named) choose(named.id);
      setHash(location.hash);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const canvases = useMemo(() => snapshot.canvases ?? [], [snapshot.canvases]);
  const canvasesRef = useRef(canvases);
  canvasesRef.current = canvases;
  
  
  
  const lastShown = useRef<string>(undefined);
  const [, showAgain] = useReducer((n: number) => n + 1, 0);
  const shownCanvas = (hash ? canvasNamedBy(canvases, hash) : undefined) ?? canvases.find((c) => c.id === lastShown.current) ?? lastCanvas(canvases, keptCanvas.current ?? null) ?? canvases[0];
  const canvasId = shownCanvas?.id;
  lastShown.current = canvasId;
  
  if (canvasId) keptCanvas.current = null;
  const canvasRef = useRef(canvasId);
  canvasRef.current = canvasId;
  useEffect(() => {
    if (!canvasId || canvasId !== chosen.current) return;
    chosen.current = undefined;
    keepCanvas(canvasId);
  }, [canvasId]);
  /**
   * Shows a canvas of the project (one just made too, which the project brings soon); the address
   * names it. The canvas of a card or plan that opens (`ofCard`) leaves the address without a hash,
   * as a card's address needs none, so the entry of the history goes on meaning "where the owner
   * left"; one the owner did not choose (a card or plan that comes back) is no choice either.
   */
  const showCanvas = (c: Canvas | string, ofCard = false) => {
    const picked = !restoring.current;
    const to = typeof c === 'string' ? canvases.find((x) => x.id === c) : c;
    
    
    if (!to || gone.current) return;
    
    if (picked) choose(to.id);
    if (ofCard) {
      if (to.id === canvasRef.current) return;
      lastShown.current = to.id;
      if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
      flushSync(() => (setHash(''), showAgain()));
      return;
    }
    const h = `#${encodeURIComponent(to.name)}`;
    if (to.id === canvasRef.current && location.hash === h) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${h}`);
    flushSync(() => setHash(h));
  };
  /** The canvas shown was renamed: an address naming it follows the new name; one without a hash stays so. */
  const renamedCanvas = (c: Canvas) => {
    if (gone.current || c.id !== canvasRef.current || !location.hash) return;
    const h = `#${encodeURIComponent(c.name)}`;
    if (location.hash === h) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${h}`);
    setHash(h);
  };
  
  
  useEffect(() => {
    if (!location.hash || !canvases.length) return;
    const named = canvasNamedBy(canvases, location.hash);
    const h = named ? `#${encodeURIComponent(named.name)}` : '';
    if (h === location.hash) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${h}`);
    setHash(h);
  }, []);
  
  const perCanvas = useMemo(() => {
    const waiting: Record<string, number> = {};
    for (const i of items) {
      if (!i.canvasVisible) continue;
      const c = i.canvas ?? canvases[0]?.id;
      if (c && needsYou(i)) waiting[c] = (waiting[c] ?? 0) + 1;
    }
    return { waiting, empty: new Set(canvases.filter((c) => !c.inUse).map((c) => c.id)) };
  }, [items, canvases]);
  
  const onShown = useCallback((i: Item) => !canvasId || (i.canvas ?? canvases[0]?.id) === canvasId, [canvasId, canvases]);
  
  const placed = useMemo(() => onProject(items.filter((i) => onShown(i) && !offCanvas(i))).map((item) => ({ item, b: boundsOf(item, items) })), [items, onShown]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  
  const groups = useMemo(() => snapshot.groups.filter((g) => !canvasId || (g.canvas ?? canvases[0]?.id) === canvasId), [snapshot.groups, canvasId, canvases]);
  const territories = useTerritories(placed, groups);
  const kidsOf = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) if (i.parent) m.set(i.parent, [...(m.get(i.parent) ?? []), i]);
    return m;
  }, [items]);
  const repliesIn = useMemo(() => unreadPerPlan(snapshot.talk), [snapshot.talk]);
  
  const prototyped = useMemo(() => new Set(items.flatMap((i) => (i.idea?.prototypeOf ? [i.idea.prototypeOf] : []))), [items]);
  const [noteHidden, hideNote] = useHiddenEmptyNotes(snapshot.project.id);
  
  const [notesMoved, setNotesMoved] = useState<Record<string, Pos>>({});
  useEffect(() => {
    const at = new Map(snapshot.planDirs?.map((d) => [d.repo, d.at]));
    setNotesMoved((m) => {
      const keep = Object.entries(m).filter(([repo, p]) => dragRef.current?.note === repo || at.get(repo)?.x !== p.x || at.get(repo)?.y !== p.y);
      return keep.length === Object.keys(m).length ? m : Object.fromEntries(keep);
    });
  }, [snapshot]);
  
  const planDirs = useMemo(() => {
    
    if (shownCanvas && shownCanvas.name !== MAIN_CANVAS) return undefined;
    const shown = snapshot.planDirs?.filter((d) => !noteHidden(d)).map((d) => (notesMoved[d.repo] ? { ...d, at: notesMoved[d.repo] } : d));
    return shown?.length ? shown : undefined;
  }, [snapshot.planDirs, noteHidden, notesMoved, shownCanvas?.name]);
  const notes = useMemo(() => (planDirs ? planDirBoxes(planDirs, placed) : []), [planDirs, placed]);
  const all: Bounds = useMemo(() => unionBounds([...placed.map((p) => p.b), ...notes]) ?? { x: 0, y: 0, w: 1000, h: 600 }, [placed, notes]);
  
  const content = useMemo(() => (placed.length || notes.length ? [minimapArea(all)] : []), [placed, notes, all]);
  const contentRef = useRef(content);
  contentRef.current = content;
  const byId = (id: string) => itemsRef.current.find((i) => i.id === id);
  /** Where a card stands on the project; a workstream of a collapsed plan, where its plan does. */
  const bounds = (i: Item) => boundsOf(standsFor(i), itemsRef.current);
  /** The card on the project that shows `i`: a workstream of a collapsed plan shows as a mark on its plan. */
  const standsFor = (i: Item) => {
    const p = i.parent ? byId(i.parent) : undefined;
    return p?.plan?.collapsed ? p : i;
  };

  
  const [cam, setCam, camRef] = useLive<Cam>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(camKey(snapshot.project.id, canvases.find((c) => c.id === canvasId))) ?? 'null');
      
      if (saved && [saved.x, saved.y, saved.s].every(Number.isFinite)) return keepInView(saved, content, { left: 0, top: TOP, right: innerWidth, bottom: innerHeight - BOTTOM });
    } catch {}
    return centreOn(all, 1);
  });
  
  
  const camSide = useRef<Sides>(NO_SIDES);
  /** Flies to `to`, laid out for the sheets as they are now. */
  const fly = (to: Cam, ms?: number) => {
    camSide.current = sideNow();
    return flyTo(camRef.current, to, setCam, ms);
  };
  const flyOrJump = async (to: Cam, ms: number, jump: boolean) => (jump ? ((camSide.current = sideNow()), setCam(to)) : fly(to, ms));
  /** The view `f` was opened from, beside the sheets as they are now. */
  const back = (f: Focus) => besideSheet(f.prevCam, f.prevSide, sideNow());
  
  const camDue = useRef<(() => void) | null>(null);
  useEffect(() => {
    document.documentElement.style.setProperty('--s', String(cam.s));
    if (focusRef.current) return;
    const save = () => {
      camDue.current = null;
      try {
        localStorage.setItem(camCanvas.current, JSON.stringify(besideSheet(cam, camSide.current, NO_SIDES)));
      } catch {}
    };
    camDue.current = save;
    const h = setTimeout(save, 300);
    return () => clearTimeout(h);
  }, [cam, snapshot.project.id]);
  
  const camCanvas = useRef(camKey(snapshot.project.id, canvases.find((c) => c.id === canvasId)));
  useEffect(() => {
    const key = camKey(snapshot.project.id, canvases.find((c) => c.id === canvasId));
    if (key === camCanvas.current) return;
    camCanvas.current = key;
    let to: Cam | undefined;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (saved && [saved.x, saved.y, saved.s].every(Number.isFinite)) to = besideSheet(saved, NO_SIDES, sideNow());
    } catch {}
    camSide.current = sideNow();
    setCam(to ?? centreOn(all, 1));
  }, [canvasId]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick((n) => n + 1);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  
  const [focus, setFocus, focusRef] = useLive<Focus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dim, setDim] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const dock = useDock(null);
  const sheetOn = dock.active === 'plan' || dock.active === 'plan-doc';
  const sheetOnRef = { get current() { return dock.ref.current === 'plan' || dock.ref.current === 'plan-doc'; } };
  const setSheetOn = (on: boolean) => {
    if (on) dock.select(readingRef.current ? 'plan-doc' : 'plan');
    else if (sheetOnRef.current) dock.select(null);
  };
  
  const [reading, setReading, readingRef] = useLive<{ mark?: string } | null>(null);
  const { widths: sheetW, resizing } = dock;
  const [kOn, setKOn, kOnRef] = dock.view('seismic');
  const chatEntry = useRef<'default' | 'type' | 'answer'>('default');
  
  const [nyOn, setNyOn, nyOnRef] = dock.view('needs-you');
  
  const inboxRead = useInboxRead();
  
  const [csOn, setCsOn, csOnRef] = dock.view('settings');
  
  const [agentsOn, setAgentsOn, agentsOnRef] = dock.view('agents');
  
  const fullPage = useFullPage<'archive' | 'parked' | 'queue' | 'table'>(() => (readView(location.search).view === 'table' ? 'table' : null));
  const [aOn, setArchiveOn, aOnRef] = useLive(false);
  
  const setAOn = (on: boolean) => { setArchiveOn(on); if (on) fullPage.show('archive'); else if (fullPage.ref.current === 'archive') fullPage.show(null); };
  /** Parked, Queue and Table, full-page views from the switcher and the menu; null goes back to the canvas. The camera stays where it was, an open card open. */
  const showPage = (id: 'parked' | 'queue' | 'table' | null) => {
    setArchiveOn(false);
    if (id || fullPage.ref.current) fullPage.show(id);
  };
  const [cOn, setCOn, cOnRef] = useLive(false);
  
  const [pinned, setPinned, pinnedRef] = useLive(loadPinned);
  const [, setNavHidden, navHiddenRef] = useLive(loadNavHidden);
  const [navWidth, setNavWidth, navWidthRef] = useLive(loadNavWidth);
  const showDocked = (on: boolean) => {
    setNavHidden(!on);
    saveNavHidden(!on);
  };
  const pin = (on: boolean) => {
    setPinned(on);
    savePinned(on);
    showDocked(true);
  };
  /**
   * What the panels docked at the window's edges take of it, as just set: the sheet on the right and
   * the docked menu on the left; the project is what remains between them. A narrow window lays
   * the sheet over the project instead (docked.tsx), and the menu drops down under ☰, as it
   * does where it would leave the project too little room beside the sheet: the two never stack.
   */
  const sideNow = (): Sides => {
    const narrow = matchMedia(NARROW).matches;
    const right = narrow ? 0 : dock.width();
    const left = navWidthRef.current;
    return { left: !narrow && pinnedRef.current && !navHiddenRef.current && innerWidth - left - right >= NAV_PROJECT_MIN ? left : 0, right };
  };
  /** Opens Seismic's sheet or closes it; an open plan closes. */
  const toggleKoordinator = (entry: typeof chatEntry.current = 'default') => {
    if (!kOn) chatEntry.current = entry;
    setKOn(!kOn);
    if (!kOn) setCsOn(false);
    if (!kOn && focusRef.current?.type === 'plan') closePlan(false);
  };
  /** The sheet as the owner opens it to talk (its button, `C`): the field under the conversation takes the cursor. */
  const talkKoordinator = () => {
    toggleKoordinator('type');
  };
  
  const toggleConfig = () => (setPrefsOn(false), setCOn(!cOnRef.current));
  
  const talkFromConfig = () => {
    setCOn(false);
    if (!kOn) talkKoordinator();
  };
  const [helpOn, setHelpOn] = useState(false);
  const searchField = useRef<HTMLInputElement>(null);
  
  const [prefsOn, setPrefsOn] = useState(false);
  
  const [newProjectOn, setNewProjectOn] = useState(false);
  const openPrefs = () => {
    setCOn(false);
    setPrefsOn(true);
  };
  
  const [phoneOn, setPhoneOn] = useState(false);
  
  
  const [perfAtStart] = useState(() => (new URLSearchParams(location.search).has('performance') ? readLogQuery(location.search).filter : undefined));
  const [perfOn, setPerfOn] = useState(!!perfAtStart);
  const openPerformance = useCallback(() => {
    setCOn(false);
    setPrefsOn(false);
    setPerfOn(true);
  }, []);
  const wishOn = useWish().open;
  
  const [helpKnown, setHelpKnown] = useState(() => known(HELP_KEY_KNOWN));
  const [helpNote, setHelpNote] = useState<'button' | 'gone'>();
  
  const [needsYouKnown, setNeedsYouKnown] = useState(() => known(NEEDS_YOU_KNOWN));
  
  
  const [problemsOf, setProblemsOf] = useState<{ project: string; n: number }>();
  
  const configProblems = problemsOf?.project === snapshot.project.id ? problemsOf.n : 0;
  const configRevs = [...snapshot.project.repos.map((r) => `${r.id}:${r.configRev ?? 0}`), ...projects.map((c) => `${c.id}:${c.configRev ?? 0}`), `${snapshot.project.configRev ?? 0}`].join(' ');
  useEffect(() => {
    let active = true;
    void api.projectRepos(snapshot.project.id).then(
      (c) => { if (active) setProblemsOf({ project: snapshot.project.id, n: c.problems.length }); },
      (e) => {
        if (!active) return;
        setProblemsOf(undefined);
        console.error(e);
      },
    );
    return () => { active = false; };
  }, [snapshot.project.id, configRevs]);
  useEffect(() => void getAgentModels('codex').catch(() => {}), [snapshot.project.id]);
  useEffect(() => void api.shownProjectSettings().then((v) => setRightClick(v.settings.rightClick), () => {}), [snapshot.project.id, csOn, cOn, configRevs]);
  
  const [archived, setArchived] = useState<Item[]>([]);
  const archivedRef = useRef(archived);
  archivedRef.current = archived;
  /** The card `id`, on the project or else in the archive. */
  const itemOrArchived = (id: string) => byId(id) ?? items.flatMap((i) => i.plan?.manualArchived ?? []).find((i) => i.id === id) ?? archivedRef.current.find((i) => i.id === id);
  const archiveEls = useRef(new Map<string, HTMLElement>()).current;
  
  const sheetEls = useRef(new Map<string, HTMLElement>()).current;
  
  const inboxEls = useRef(new Map<string, HTMLElement>()).current;
  
  const parkedEls = useRef(new Map<string, HTMLElement>()).current;
  const tableEls = useRef(new Map<string, HTMLElement>()).current;
  /** The element a card unfolds from and folds back to: its entry in the inbox's, the Parked or the Table view while that shows, on the project, or a row in the sheet it was opened from. */
  const fromEl = (id: string, inPlan: boolean) =>
    ({ parked: parkedEls, table: tableEls } as Partial<Record<string, Map<string, HTMLElement>>>)[fullPage.ref.current ?? '']?.get(id) ??
    inboxEls.get(id) ?? els.get(id) ?? (inPlan ? (sheetEls.get(id) ?? archiveEls.get(id)) : (archiveEls.get(id) ?? sheetEls.get(id)));
  
  const [opened, setOpened] = useState<Item | null>(null);
  useEffect(() => {
    if (!aOn && !items.some((i) => i.idea?.proposal?.merge && !items.some((p) => p.id === i.idea!.proposal!.merge!.with))) return;
    let current = true;
    api.archived().then((a) => current && setArchived(a), console.error);
    return () => void (current = false);
  }, [aOn, snapshot]);
  const [popId, setPopId] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>()).current;
  const panelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  useBarFit(barRef);
  const rowRef = useRef<HTMLDivElement>(null);
  useBarFit(rowRef);
  const innerRef = useRef<HTMLDivElement>(null);
  
  const unfolded = useRef(false);
  
  const folding = useRef<Promise<void> | null>(null);
  const fitPanel = (i: Item) => {
    const panel = panelRef.current;
    const inner = innerRef.current;
    if (!panel || !inner) return;
    const side = sideNow();
    
    const keep = dock.besideCard() ? side.right : 0;
    Object.assign(panel.style, panelRect(i, inner, side, keep));
  };

  
  const edit = useRef<{ id: string; patch: CardPatch; timer?: ReturnType<typeof setTimeout> } | null>(null);
  /** Saves what was typed into the open card; actions on it wait for this. */
  const flushEdit = (): Promise<void> => {
    const e = edit.current;
    if (!e) return Promise.resolve();
    clearTimeout(e.timer);
    edit.current = null;
    return Object.keys(e.patch).length ? patchCard(e.id, e.patch).then(() => {}) : Promise.resolve();
  };
  
  const openDraft = useRef<Pick<Item, 'kind' | 'title' | 'body' | 'images'>>({ kind: 'task', title: '', body: '' });
  const onEdit = (p: CardPatch, card?: string) => {
    const open = focusRef.current?.id;
    const id = card ?? open;
    if (!id) return;
    if (id === open) {
      if (p.title !== undefined) openDraft.current.title = p.title;
      if (p.body !== undefined) openDraft.current.body = p.body;
      if (p.images !== undefined) openDraft.current.images = p.images;
    }
    if (edit.current?.id !== id) flushEdit().catch(console.error);
    const e = (edit.current ??= { id, patch: {} });
    Object.assign(e.patch, p);
    clearTimeout(e.timer);
    e.timer = setTimeout(() => flushEdit().catch(console.error), 400);
  };

  /** Unfolds the card `i`; `quick` without the flight and the unfold, as after a reload. */
  async function open(i: Item, reload = false) {
    i = activeMergeCard(i, itemsRef.current);
    if (focusRef.current?.type !== 'card') opener.current = onControl(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    
    const hold = !reload && reducedMotion();
    const quick = reload || hold;
    const f = focusRef.current;
    if (f?.type === 'card') return;
    
    if (i.canvas && i.canvas !== canvasRef.current && !i.archivedAt && !offCanvas(i)) showCanvas(i.canvas, true);
    if (i.kind === 'plan') return openPlan(i);
    cardsOn(snapshot.project.id, [i.id]);
    setFocus({ type: 'card', id: i.id, prevCam: camRef.current, prevSide: camSide.current, plan: f });
    openDraft.current = { kind: i.kind, title: i.title, body: i.body, images: i.images ?? [] };
    setOpened(i.archivedAt ? i : null);
    
    
    
    if (!i.archivedAt && !offCanvas(i) && !fullPage.ref.current) await flyOrJump(centreOnPoint(bounds(i), Math.max(camRef.current.s, 0.85), sideNow()), FLY_MS, quick);
    
    if (!i.archivedAt && offCanvas(i) && !fromEl(i.id, !!f)) {
      showPage('parked');
      await soon(() => parkedEls.get(i.id));
    }
    const el = fromEl(i.id, !!f);
    const panel = panelRef.current;
    
    if (!el || !panel) return setFocus(f);
    addressOpens(i, f ? itemOrArchived(f.id) : undefined);
    const r = el.getBoundingClientRect();
    flushSync(() => setOpenId(i.id));
    for (const [k, v] of Object.entries(stateVars(shownState(i)))) panel.style.setProperty(k, v);
    panel.classList.remove('anim', 'ready');
    panel.style.setProperty('--unfold', `${quick ? 0 : UNFOLD_MS}ms`);
    Object.assign(panel.style, rect(r), { display: 'block', visibility: hold ? 'hidden' : '' });
    panel.getBoundingClientRect();
    panel.classList.add('anim');
    fitPanel(i);
    unfolded.current = true;
    
    const content = innerRef.current?.firstElementChild;
    if (hold && content) {
      await sizeSettled(content, SETTLE_QUIET_MS, SETTLE_CAP_MS);
      if (!unfolded.current || focusRef.current?.id !== i.id) return;
      panel.style.visibility = '';
    }
    setDim(true);
    if (!quick) await sleep(UNFOLD_MS);
    panel.classList.add('ready');
    
    const title = panel.querySelector<HTMLTextAreaElement>('textarea.p-title');
    const body = panel.querySelector<HTMLElement>('.p-body');
    if (title && !title.value) (body ?? title).focus();
    
    
    
    
    if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    
    if (body && body === document.activeElement) {
      getSelection()?.selectAllChildren(body);
      getSelection()?.collapseToEnd();
    }
  }

  
  const openItem = openId
    ? (itemOrArchived(openId) ?? (opened?.id === openId ? opened : undefined))
    : undefined;
  const openState = openItem && `${shownState(openItem)}:${openItem.need ?? ''}:${split(openItem)}`;
  useEffect(() => {
    const panel = panelRef.current;
    const i = openItem;
    if (!panel || !i || !unfolded.current) return;
    for (const [k, v] of Object.entries(stateVars(shownState(i)))) panel.style.setProperty(k, v);
    fitPanel(i);
  }, [openState]);
  
  useEffect(() => {
    const content = innerRef.current?.firstElementChild;
    if (!openId || !content) return;
    
    
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const i = itemOrArchived(openId);
        if (i && unfolded.current) fitPanel(i);
      });
    });
    ro.observe(content);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [openId]);
  
  useEffect(() => {
    const i = openId && itemOrArchived(openId);
    if (i && unfolded.current) fitPanel(i);
  }, [tick]);

  
  useEffect(() => {
    if (!openItem) return;
    const owner = activeMergeCard(openItem, items);
    if (owner.id !== openItem.id) void openFresh(owner);
  }, [openItem, items]);

  
  useEffect(() => {
    if (openId && !openItem && focusRef.current?.type === 'card') closeCard({ keepUntitled: true });
  }, [openId, openItem]);

  function onDone(d: ActDone, p?: Pending) {
    if (!d.close) return;
    
    const gone = focusRef.current?.type === 'card' ? focusRef.current.id : undefined;
    const folded = closeCard({ keepUntitled: true });
    if (d.next) void folded.then(() => openOnward(gone, d.next!));
    if (!p || !d.pending) {
      if (d.rate) ratePrompt.ask(d.rate);
      if (d.ack) showAck(d.ack, d.undo);
      return;
    }
    
    const what = d.pending;
    setUnderway((u) => ({ ...u, [p.card]: what }));
    const done = showWait(`${what.charAt(0).toUpperCase()}${what.slice(1)}`);
    p.answered.then(
      () => {
        if (d.rate) ratePrompt.ask(d.rate);
        if (d.ack) showAck(d.ack, d.undo);
        else done();
      },
      (e) => {
        if (!(e instanceof ApiError)) console.error(e);
        setUnderway(({ [p.card]: _, ...rest }) => rest);
        
        done();
        warnings.show(t.cardError(p.title, failText(e)), p.card);
      },
    );
  }

  /**
   * After the card `gone` folded into `next` (a merge approved): once the project no longer shows it,
   * and so shows `next` where it now stands, flies there and opens it.
   */
  async function openOnward(gone: string | undefined, next: string) {
    const i = await soon(() => gone && byId(gone) ? undefined : byId(next));
    if (i && focusRef.current?.type !== 'card') await open(i);
  }

  
  const opener = useRef<HTMLElement | null>(null);
  /** Folds the open card; `onward` where another opens in its place next, which takes over its address. */
  function closeCard(o: { keepUntitled?: boolean; onward?: boolean } = {}): Promise<void> {
    
    folding.current ??= foldCard(o).finally(() => { folding.current = null; });
    return folding.current;
  }
  async function foldCard({ keepUntitled = false, onward = false }) {
    const f = focusRef.current;
    const panel = panelRef.current;
    if (f?.type !== 'card' || !panel) return;
    if (!onward) addressCloses(f.plan ? itemOrArchived(f.plan.id) : undefined);
    const saved = flushEdit().catch(console.error);
    panel.querySelector('video')?.pause();
    const i = byId(f.id);
    const el = fromEl(f.id, !!f.plan);
    unfolded.current = false;
    panel.classList.remove('ready');
    if (el) Object.assign(panel.style, rect(el.getBoundingClientRect()));
    setDim(false);
    await sleep(motionMs(UNFOLD_MS));
    panel.style.display = 'none';
    panel.classList.remove('anim', 'ready');
    
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected && (panel.contains(document.activeElement) || document.activeElement === document.body)) back.focus({ preventScroll: true });
    beingWritten.delete(f.id);
    setOpenId(null);
    setFocus(f.plan);
    
    const draft = openDraft.current;
    if (i?.source === 'manual' && !draft.title.trim()) {
      if (nameless(draft)) saved.then(() => actCard(i.id, { action: 'name' })).catch(console.error);
      else if (!keepUntitled) removeCard(i.id).catch(console.error);
    }
    
    
    recover();
  }

  /**
   * Opens a card the server made just now (a thread moved onto a Question card), which the project
   * may not show yet; a card open now folds first.
   */
  async function openFresh(i: Item) {
    const f = focusRef.current;
    if (f?.type === 'card') {
      if (f.id === activeMergeCard(i, itemsRef.current).id) return;
      await closeCard({ keepUntitled: true, onward: true });
    }
    flushSync(() => {
      if (!snapshotRef.current.items.some((x) => x.id === i.id)) setPending((p) => [...p, i]);
    });
    await open(i);
  }

  async function openPlan(p: Item, quick = false) {
    
    await planSheet(p, null, quick, !p.archivedAt);
  }

  /** Reads the plan's plan doc in the sheet, at the workstream `mark`; `null` goes back to the workstreams. */
  async function readPlan(p: Item, r: { mark?: string } | null, quick = false) {
    if (focusRef.current?.type === 'card') await closeCard();
    
    await planSheet(p, r, quick, true);
  }

  /** Shows the plan in the sheet, its workstreams or (`r`) its plan doc, and with `inView` flies to it. */
  async function planSheet(p: Item, r: { mark?: string } | null, quick: boolean, inView: boolean) {
    
    if (p.canvas && p.canvas !== canvasRef.current && !p.archivedAt) showCanvas(p.canvas, true);
    const f = focusRef.current;
    if (f?.type !== 'plan') planOpener.current = onControl(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    setFocus(f?.type === 'plan' ? { ...f, id: p.id } : { type: 'plan', id: p.id, prevCam: camRef.current, prevSide: camSide.current });
    addressOpens(p, undefined);
    setSheetId(p.id);
    setReading(r);
    setSheetOn(true);
    setAOn(false);
    
    if (inView && !fullPage.ref.current) await flyOrJump(camFor(bounds(p), sideNow()), 700, quick);
  }

  
  const planOpener = useRef<HTMLElement | null>(null);
  /** Closes the open plan; `toArchive`: back to the archive an archived one was opened from. */
  async function closePlan(toArchive = true) {
    const f = focusRef.current;
    if (f?.type !== 'plan') return;
    setFocus(null);
    addressCloses(undefined);
    setSheetOn(false);
    const title = planOpener.current;
    planOpener.current = null;
    const at = document.activeElement;
    if (title?.isConnected && (at === document.body || at?.closest('#sheet, #sheet-close'))) title.focus({ preventScroll: true });
    if (toArchive && archivedRef.current.some((i) => i.id === f.id) && !itemsRef.current.some((i) => i.id === f.id)) setAOn(true);
    
    if (!fullPage.ref.current) await fly(back(f), 600);
    recover();
  }

  /** The card (a plan with its workstreams) goes onto another canvas: it folds away, and the canvas shown stays. */
  async function moveCard(i: Item, to: Canvas) {
    const title = plain(i.title) || titleFrom(i.body);
    if (focusRef.current?.type === 'card' && focusRef.current.id === i.id) {
      await flushEdit();
      await closeCard({ keepUntitled: true });
    }
    if (focusRef.current?.type === 'plan' && focusRef.current.id === i.id) await closePlan(false);
    try {
      await api.moveToCanvas([i.id], to.id);
      showAck(t.canvases.moved(title, canvasText(to)));
    } catch (err) {
      fail(err);
    }
  }

  async function deleteOpen() {
    const f = focusRef.current;
    if (f?.type !== 'card') return;
    const i = byId(f.id);
    const title = openDraft.current.title.trim() || titleFrom(openDraft.current.body);
    if (edit.current) clearTimeout(edit.current.timer);
    edit.current = null;
    
    openDraft.current = { kind: i?.kind ?? 'task', title: '', body: '' };
    await closeCard({ keepUntitled: true });
    if (!i) return;
    await removeCard(i.id);
    if (title) showAck(t.deleted(plain(title)), () => restoreCard(i.id));
  }

  /** A new card centred at `world`; `made` runs once it exists, before it opens. */
  async function createAt(world: Pos, { group, made }: { group?: string; made?: (card: Item) => Promise<unknown> } = {}) {
    const [w, h] = CARD_SIZE.task;
    const card = await api.create({ title: '', x: Math.round(world.x - w / 2), y: Math.round(world.y - h / 2), canvas: canvasRef.current ?? undefined, group });
    await made?.(card);
    beingWritten.add(card.id);
    flushSync(() => {
      
      if (!snapshotRef.current.items.some((i) => i.id === card.id)) setPending((p) => [...p, card]);
      setPopId(card.id);
    });
    await open(card);
  }
  const createAtCentre = () => createAt(toWorld(camRef.current, midX(sideNow()), innerHeight / 2));

  
  
  const keepNow = useRef(() => {});
  keepNow.current = () => {
    flushEdit().catch(console.error);
    const f = focusRef.current;
    const plan = f?.type === 'plan' ? f.id : f?.type === 'card' ? f.plan?.id : undefined;
    const sheet: SideSheet | undefined = kOn ? 'koordinator' : nyOn ? 'needs-you' : csOn ? 'settings' : agentsOn ? 'agents' : aOn ? 'archive' : undefined;
    keep(draftSession, snapshot.project.id, {
      at: Date.now(),
      ...(f?.type === 'card' ? { card: f.id } : {}),
      ...(plan ? { plan, reading: !!readingRef.current } : {}),
      ...(sheet ? { sheet } : {}),
      ...(cOn ? { config: true } : {}),
      ...(prefsOn ? { prefs: true } : {}),
      ...collect(),
    });
  };
  useEffect(() => beforeReload(() => keepNow.current()), []);
  
  
  
  const gone = useRef(false);
  const stopRestore = useRef<(() => void) | null>(null);
  useLayoutEffect(
    () => () => {
      keepNow.current();
      camDue.current?.();
      gone.current = true;
      stopRestore.current?.();
    },
    [],
  );
  
  useEffect(() => {
    const away = () => leaveSheet(sessionStorage, snapshot.project.id, kOnRef.current && drafted(SEISMIC_DRAFT));
    addEventListener('pagehide', away);
    return () => {
      removeEventListener('pagehide', away);
      
      away();
    };
  }, []);
  useEffect(() => {
    const project = snapshot.project.id;
    const k = takeKept(draftSession, project);
    const sheetLeft = takeSheetLeft(sessionStorage, project);
    
    
    const a = readAddress();
    const code = !a.project || projectNamed(projects, a.project)?.id === snapshot.project.id ? a.card : undefined;
    const talk = new URLSearchParams(location.search).get('talk');
    if (talk === 'answer') chatEntry.current = 'answer';
    history.replaceState(history.state, '', `${code ? cardPath(snapshot.project.id, code) : projectPath(snapshot.project.id)}${queryWithout(location.search, 'c', 'card', 'talk', ...(perfAtStart ? LOG_KEYS : []))}${location.hash}`);
    
    
    addressSet.current = true;
    
    
    const came = cameByGoTo();
    restoring.current = !(code && came);
    const done = () => {
      addressSet.current = false;
      restoring.current = false;
      
      if (gone.current) return;
      history.replaceState(history.state, '', pathOf(openNow()));
    };
    const restoreView = (kept: Kept) => {
      
      if (code && named(itemsRef.current, code)?.id !== kept.card) kept = { ...kept, card: code, plan: undefined, scroll: [], drafts: [], video: undefined };
      if (talk !== null) kept = { ...kept, sheet: 'koordinator' };
      return reopen(kept).catch(console.error).finally(done);
    };
    const showSheet = () => {
      
      quickSide.current = Date.now() + 2000;
      setKOn(true);
    };
    if (!k && (sheetLeft || talk !== null)) showSheet();
    const opened = k ? restoreView(k) : (code ? openAddress(code, true) : Promise.resolve()).catch(console.error).finally(done);
    if (!window.seismicApp?.handedOver) return;
    
    let used = false;
    const usePage = (event: Event) => { if (event.isTrusted) used = true; };
    const events = ['pointerdown', 'keydown', 'wheel', 'input', 'popstate'] as const;
    for (const event of events) addEventListener(event, usePage, true);
    const off = onHandOverEntries((keys) => {
      if (gone.current) return;
      const late = keys.has(keptKey(project)) ? takeKept(draftSession, project) : null;
      const lateSheet = keys.has(sheetKey(project)) && takeSheetLeft(sessionStorage, project);
      if ((!late && !lateSheet) || k) return;
      return opened.then(() => {
        if (used || gone.current) return;
        if (late) {
          addressSet.current = true;
          restoring.current = true;
          return restoreView(late);
        }
        showSheet();
      });
    });
    return () => {
      off();
      for (const event of events) removeEventListener(event, usePage, true);
    };
  }, []);
  async function reopen(k: Kept) {
    
    quickSide.current = Date.now() + 2000;
    if (k.sheet === 'koordinator') setKOn(true);
    else if (k.sheet === 'needs-you') setNyOn(true);
    else if (k.sheet === 'settings') setCsOn(true);
    else if (k.sheet === 'agents') setAgentsOn(true);
    else if (k.sheet === 'archive') setAOn(true);
    if (k.config) setCOn(true);
    if (k.prefs) setPrefsOn(true);
    await openAgain(k, true);
    if (gone.current) return;
    stopRestore.current = restore(k);
  }
  /** Opens the plan `k.plan` (its plan doc with `reading`) and the card `k.card` in it or on the project; an archived one from its row in the archive or the plan's sheet. */
  async function openAgain(k: Pick<Kept, 'card' | 'plan' | 'reading'>, quick: boolean) {
    const find = async (id?: string) => (id ? namedBy(id) : undefined);
    
    const p = await find(k.plan);
    
    if (p) await (k.reading ? readPlan(p, {}, quick) : openPlan(p, quick));
    const i = await find(k.card);
    
    if (i && (!i.archivedAt || (await soon(() => fromEl(i.id, !!p))))) await open(i, quick);
  }

  
  
  
  
  
  const addressChain = useRef(Promise.resolve());
  
  const address = (change: () => void | Promise<void>) => void (addressChain.current = addressChain.current.then(() => (gone.current ? undefined : change())).catch(console.error));
  
  const stepBack = useRef<(() => void) | null>(null);
  
  const addressSet = useRef(false);
  /** The card or plan open now. */
  const openNow = () => {
    const f = focusRef.current;
    return f ? itemOrArchived(f.id) : undefined;
  };
  
  const searchNow = () => withView(location.search, fullPage.ref.current === 'table' ? 'table' : undefined);
  const pathOf = (i: Item | undefined) => `${i ? cardPath(snapshot.project.id, i) : projectPath(snapshot.project.id)}${searchNow()}${location.hash}`;
  /** The address names the view shown, in place: switching views is no step in the history, as switching canvases is not. */
  const addressView = () => {
    const s = searchNow();
    if (s !== location.search) history.replaceState(history.state, '', `${location.pathname}${s}${location.hash}`);
  };
  
  useEffect(() => {
    if (!gone.current) addressView();
  }, [fullPage.active]);
  /** `i` opens over `under` (the plan it is opened from, else the project). */
  function addressOpens(i: Item, under: Item | undefined) {
    if (addressSet.current) return;
    address(() => {
      const at = readAddress().card;
      if (at && named([i], at)) return;
      if (!at || (under && named([under], at))) history.pushState({ step: true, from: location.search }, '', pathOf(i));
      else history.replaceState(history.state, '', pathOf(i));
    });
  }
  /** What is open closes down to `under` (the plan still open, else the project). */
  function addressCloses(under: Item | undefined) {
    if (addressSet.current) return;
    address(() => {
      const st = history.state as { step?: true; from?: string } | null;
      if (!st?.step) return history.replaceState(history.state, '', pathOf(under));
      
      if (st.from !== undefined && st.from !== searchNow()) return history.replaceState(null, '', pathOf(under));
      return new Promise<void>((done) => {
        stepBack.current = () => {
          
          
          const at = readAddress().card;
          if ((at && !(under && named([under], at))) || location.search !== searchNow()) history.replaceState(history.state, '', pathOf(under));
          done();
        };
        history.back();
      });
    });
  }
  /** The card or plan an address (or an id) names, on the project or in the archive, which it loads where it has to. */
  async function namedBy(code: string) {
    const here = named(itemsRef.current, code) ?? named(archivedRef.current, code);
    if (here) return activeMergeCard(here, itemsRef.current);
    const gone = await api.archived().catch(() => []);
    archivedRef.current = gone;
    setArchived(gone);
    return named(gone, code);
  }
  /** Opens what the address names; a code no card has leaves the project, at its address. */
  async function openAddress(code: string, quick: boolean) {
    const i = await namedBy(code);
    if (gone.current) return;
    
    history.replaceState(history.state, '', pathOf(i));
    if (!i) return;
    if (i.kind === 'plan') return openAgain({ plan: i.id }, quick);
    
    const plan = i.archivedAt ? i.parent : undefined;
    if (i.archivedAt && !plan) setAOn(true);
    await openAgain({ card: i.id, plan }, quick);
  }
  /** Opens the card a code names in place of the card open now, as a link to it does; an archived one from its row in the archive or its plan's sheet. */
  async function openNamed(code: string) {
    const i = await namedBy(code);
    if (!i) return;
    if (i.kind === 'plan') return openPlan(i);
    const f = focusRef.current;
    if (f?.type === 'card') {
      if (f.id === activeMergeCard(i, itemsRef.current).id) return;
      await closeCard({ keepUntitled: true, onward: true });
    }
    const plan = i.archivedAt ? i.parent : undefined;
    if (i.archivedAt && !plan) setAOn(true);
    await openAgain({ card: i.id, plan }, false);
  }
  /** Back or Forward: what the address no longer names closes, what it names opens. */
  async function followAddress(search = location.search) {
    
    const view = followedView(search, fullPage.ref.current);
    if (view !== undefined && view !== fullPage.ref.current) showPage(view);
    const code = readAddress().card;
    const i = code ? await namedBy(code) : undefined;
    addressSet.current = true;
    try {
      const f = focusRef.current;
      if (f?.type === 'card' && f.id !== i?.id) await closeCard({ keepUntitled: true });
      const p = focusRef.current;
      if (p?.type === 'plan' && p.id !== i?.id && i?.parent !== p.id) await closePlan(false);
      
      if (code && (!i || focusRef.current?.id !== i.id)) await openAddress(code, false);
    } finally {
      addressSet.current = false;
    }
  }
  const follow = useRef(followAddress);
  follow.current = followAddress;
  useEffect(() => {
    const pop = () => {
      
      const a = readAddress().project;
      if (a && projectNamed(projectsRef.current, a)?.id !== snapshotRef.current.project.id) return;
      const done = stepBack.current;
      stepBack.current = null;
      if (done) done();
      else {
        
        const search = location.search;
        address(() => follow.current(search).then(addressView));
      }
    };
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);

  
  const toasts = useToasts();
  const { showAck, showWait, fail } = useAck(toasts.store);
  const [manualStart, setManualStart] = useState<{ item: Item; names: string } | null>(null);
  
  const warnings = useWarnings(toasts.store, (id) => void openNamed(id).catch(console.error));
  const ratePrompt = useRatePrompt(items);

  
  const startCardNow = useCallback(async (i: Item) => {
    try {
      await startCardAgent(i.id, { skipWaitForCards: !!i.queue });
      if (i.queue) showAck(forcedText(i.queue));
    } catch (e) {
      fail(e);
    }
  }, []);
  
  const startCard = useCallback((i: Item) => {
    const waiting = i.queue ? manualPrerequisites(i, itemsRef.current) : [];
    if (waiting.length) {
      setManualStart({ item: i, names: waiting.map((card) => plain(card.title)).join(', ') });
      return;
    }
    void startCardNow(i);
  }, [startCardNow]);

  
  const archiveOnCanvas = useCallback(async (i: Item) => {
    try {
      await archiveCard(i.id);
      ratePrompt.ask(i.id);
      showAck(t.archive.archived(plain(i.title)), () => unarchiveCard(i.id));
    } catch (e) {
      fail(e);
    }
  }, []);

  



  const startAll = useCallback(async (p: Item, n: number) => {
    try {
      await startCardAgent(p.id);
      showAck(
        t.plan.startedAll(n),
        async () => {
          try {
            await dequeueCard(p.id);
            showAck(t.plan.startTakenBack);
          } catch (e) {
            showAck(e instanceof ApiError && e.code === 'notQueued' ? t.voice.tooLate : t.offlineError);
          }
        },
        START_ALL_HOLD_MS,
      );
    } catch (e) {
      fail(e);
    }
  }, []);

  



  const keepWorkstation = useCallback(async (i: Item) => {
    try {
      await actCard(i.id, { action: 'keepWorkstation' });
      showAck(t.workstations.keptBack(plain(i.title)));
    } catch (e) {
      showAck(e instanceof ApiError && e.code === 'notEvictable' ? t.voice.tooLate : failText(e));
    }
  }, []);
  const takeWorkstation = useCallback(async (i: Item) => {
    try {
      await actCard(i.id, { action: 'takeWorkstation' });
      showAck(t.workstations.taken(plain(i.title)), () => keepWorkstation(i), EVICT_HOLD_MS);
    } catch (e) {
      fail(e);
    }
  }, []);

  




  const arrange = useCallback(async (p: Item) => {
    const before = [p, ...itemsRef.current.filter((i) => i.parent === p.id)].map(({ id, x, y }) => ({ id, x, y }));
    try {
      await actCard(p.id, { action: 'arrange' });
      showAck(t.plan.arranged, async () => {
        try {
          await Promise.all(before.map(({ id, x, y }) => patchCard(id, { x, y })));
          showAck(t.plan.arrangeUndone);
        } catch (e) {
          fail(e);
        }
      });
    } catch (e) {
      fail(e);
    }
  }, []);

  
  const collapse = useCallback(async (p: Item, collapsed: boolean) => {
    setFolded((f) => ({ ...f, [p.id]: collapsed }));
    try {
      await patchCard(p.id, { collapsed });
    } catch (e) {
      setFolded(({ [p.id]: _, ...rest }) => rest);
      fail(e);
    }
  }, []);
  
  const openRef = useRef(open);
  openRef.current = open;
  const openCard = useCallback((i: Item) => void openRef.current(i).catch(console.error), []);
  const openFreshRef = useRef(openFresh);
  openFreshRef.current = openFresh;
  
  const openFreshCard = useCallback((i: Item) => void openFreshRef.current(i), []);
  
  const underwayRef = useRef(underway);
  underwayRef.current = underway;
  const isUnderway = useCallback((id: string) => !!underwayRef.current[id], []);
  const notifyAsk = useDesktopNotifications(snapshot, openCard);

  
  const preparePlanDoc = useCallback(async (dir: PlanDir, file: string) => {
    try {
      const card = await api.preparePlanDoc(snapshot.project.id, dir.repo, file);
      showAck(t.planDir.started(plain(card.title)));
    } catch (e) {
      fail(e);
    }
  }, []);

  
  const where = (): Where => {
    const f = focusRef.current;
    return f?.type === 'card' ? { card: f.id } : f?.type === 'plan' ? { plan: f.id } : null;
  };
  
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => void (pointerAt.current = { x: e.clientX, y: e.clientY });
    const out = (e: MouseEvent) => void (e.relatedTarget || (pointerAt.current = null));
    addEventListener('pointermove', move, true);
    document.addEventListener('mouseout', out);
    return () => {
      removeEventListener('pointermove', move, true);
      document.removeEventListener('mouseout', out);
    };
  }, []);
  /** The project on the screen: beside the sheets, below the top bar and above the microphone. */
  const viewNow = () => {
    const side = sideNow();
    return { left: side.left, top: TOP, right: innerWidth - side.right, bottom: innerHeight - BOTTOM };
  };
  /**
   * Where a card a command makes goes: under the pointer on the project, else in the middle of the
   * view (`pointer` false: always there); with a card or plan open, in the view it goes back to.
   */
  const placeNow = (pointer = true): Place => {
    const f = focusRef.current;
    const at = placeIn(f ? back(f) : camRef.current, viewNow(), f || !pointer ? null : pointerAt.current);
    return canvasRef.current ? { ...at, canvas: canvasRef.current } : at;
  };
  
  const newCardWatch = useRef<{ known: Set<string>; until: number } | null>(null);
  function onHeard(h: Heard) {
    
    if (h.quiet) return;
    
    if (h.wish) openWish(h.wish);
    if (h.token && !focusRef.current) newCardWatch.current = { known: new Set(itemsRef.current.map((i) => i.id)), until: Date.now() + 20_000 };
  }
  
  const told = useTold(
    toasts.store,
    onHeard,
    (h) =>
      !cOnRef.current &&
      ((kOnRef.current && snapshotRef.current.talk.some((x) => x.id === h.talk && x.chat === snapshotRef.current.chat)) ||
        (!!h.inCard && focusRef.current?.type === 'card' && focusRef.current.id === h.inCard) ||
        (!!h.plan && sheetOnRef.current && !readingRef.current && focusRef.current?.type === 'plan' && focusRef.current.id === h.plan)),
    (c) => goToMade(c),
  );
  const { tellAbout, tellTyped, tellChat } = tellers(byId, told, fail, placeNow);
  /** "Go to card" on a confirmation's line: the card it made opens (in place of one open), one made on another project opens there. */
  function goToMade(c: { id: string; project?: string }) {
    if (c.project && c.project !== snapshotRef.current.project.id) return goTo(cardPath(c.project, c.id));
    newCardWatch.current = null;
    setKOn(false);
    void openNamed(c.id).catch(console.error);
  }
  
  const openSoon = useRef<{ id: string; until: number } | null>(null);
  useEffect(() => {
    const o = openSoon.current;
    if (!o) return;
    const i = snapshot.items.find((x) => x.id === o.id);
    if (!i && Date.now() < o.until) return;
    openSoon.current = null;
    if (!i || focusRef.current) return;
    newCardWatch.current = null;
    setKOn(false);
    void open(i);
  }, [snapshot]);
  useEffect(() => {
    const w = newCardWatch.current;
    if (!w) return;
    if (Date.now() > w.until) return void (newCardWatch.current = null);
    const made = snapshot.items.find((i) => i.source === 'manual' && !w.known.has(i.id));
    if (!made || focusRef.current) return;
    newCardWatch.current = null;
    setPopId(made.id);
    
    if (made.state === 'idea') {
      setKOn(false);
      open(made);
    } else if (!shows(camRef.current, viewNow(), boundsOf(made, itemsRef.current))) fly(centreOnPoint(boundsOf(made, itemsRef.current), Math.max(camRef.current.s, 0.8), sideNow()), 700);
  }, [snapshot]);
  
  
  useEffect(
    () =>
      onNotice((n) => {
        
        
        if (n.made && n.token) return told.made(n.token, n.made);
        if (n.level === 'warning') return warnings.show(noticeLine(n.text), n.cardId);
        const f = focusRef.current;
        if (n.movedTo && n.cardId && f?.type === 'card' && f.id === n.cardId) return goTo(cardPath(n.movedTo, n.cardId));
        const i = itemsRef.current.find((x) => x.id === n.cardId);
        if (n.wish) openWish(n.wish);
        
        if (n.open && n.cardId && !focusRef.current) {
          if (i) {
            setKOn(false);
            void open(i);
          } else openSoon.current = { id: n.cardId, until: Date.now() + 10_000 };
        }
        told.show(i ? { id: i.id, title: plain(i.title) } : undefined, { confirm: noticeLine(n.text), ...(n.token ? { token: n.token } : {}), ...(n.undoMs ? { undoMs: n.undoMs } : {}), ...(n.talk ? { talk: n.talk } : {}), ...(n.plan ? { plan: n.plan } : {}), ...(n.inTalk && n.cardId ? { inCard: n.cardId } : {}) });
      }),
    [],
  );
  /** The draft of the field that speaks to `target`, whether or not it is on the page: the open card's, or Seismic's sidebar's. */
  const draftFor = (target: Where) => (target && 'card' in target ? cardDraft(target.card) : !target && kOnRef.current ? SEISMIC_DRAFT : null);
  /** The draft a recording for `target` goes out with: its field's, or without one on the page the screenshots beside the mic. */
  const fieldFor = (target: Where) => {
    const key = draftFor(target);
    return key && fieldOn(key) ? key : MIC_DRAFT;
  };
  const ptt = usePushToTalk(where, fieldFor, tellAbout, (h) => showAck(h.confirm), placeNow);
  const pttRef = useRef(ptt);
  pttRef.current = ptt;
  
  
  const pressing = useRef<{ video: HTMLVideoElement | null; playing: boolean; at: number; space: boolean; dictating: boolean } | null>(null);
  /** Space or the microphone held: the demo video pauses, so its narration stays out of the recording. */
  const press = (space: boolean) => {
    const f = focusRef.current;
    const video = f?.type === 'card' ? (videoOf(f.id) ?? panelRef.current?.querySelector('video') ?? null) : null;
    pressing.current = { video, playing: !!video && !video.paused, at: performance.now(), space, dictating: !!focusedDraft() };
    video?.pause();
    
    pttRef.current.start(space && video ? SPACE_SHOWS_MS : 0);
  };
  /**
   * Let go: a tap on Space plays or pauses the video; after speaking, a video that played plays on,
   * unless the words went into a field, where the owner goes on writing about the place it stands at.
   */
  const letGo = () => {
    const p = pressing.current;
    pressing.current = null;
    pttRef.current.stop();
    if (!p?.video) return;
    const tap = p.space && performance.now() - p.at < TAP_MS;
    if (tap ? !p.playing : p.playing && !p.dictating) p.video.play().catch(() => {});
  };
  const letGoRef = useRef(letGo);
  letGoRef.current = letGo;
  const pressRef = useRef(press);
  pressRef.current = press;
  const holdToTalk = useCallback(() => pressRef.current(false), []);
  useEffect(() => {
    const up = (e: KeyboardEvent) => e.code === 'Space' && letGoRef.current();
    const release = () => letGoRef.current();
    
    const paste = (e: ClipboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return;
      const files = imageFiles(e.clipboardData?.files);
      const key = fieldFor(where());
      if (!files.length || !takesImages(key)) return;
      e.preventDefault();
      pastedShots();
      void attachTo(key, files);
    };
    addEventListener('keyup', up, true);
    addEventListener('pointerup', release);
    addEventListener('paste', paste);
    return () => {
      removeEventListener('keyup', up, true);
      removeEventListener('pointerup', release);
      removeEventListener('paste', paste);
    };
  }, []);
  const focusItem = focus ? itemOrArchived(focus.id) : undefined;
  const target = voiceTarget(focus && { type: focus.type, item: focusItem });
  
  useEffect(() => {
    const h = setTimeout(() => reportFocus(placeNow(false)), 300);
    return () => clearTimeout(h);
  }, [focus?.type, focus?.id, cam, tick, kOn, sheetOn, sheetW.sheet, canvasId]);

  
  const viewportRef = useRef<HTMLDivElement>(null);
  
  const panRef = useRef<{ x: number; y: number; from: Pos } | null>(null);
  
  
  
  type Drag = { id: string; note?: string; to?: Pos; with: { id: string; start: Pos }[]; shift: boolean; x: number; y: number; px: number; py: number; grab: Pos; start: Pos; limit: Bounds; moved: boolean; frame: number; last: number };
  const dragRef = useRef<Drag | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragWith, setDragWith] = useState<string[]>([]);
  
  const [hoverId, setHoverId] = useState<string | null>(null);
  
  const [touchy, setTouchy] = useState(false);
  const touchyRef = useRef(false);
  const touchEl = useRef<Element | null>(null);
  const touchesRef = useRef<Touches | null>(null);
  
  const [touchFocus, setTouchFocus] = useState<string | null>(null);
  
  const [holdKnown, setHoldKnown] = useState(() => known(TOUCH_HOLD_KNOWN));
  const coarse = useMemo(() => matchMedia('(pointer: coarse)').matches, []);
  const learnHold = () => {
    if (holdKnown) return;
    know(TOUCH_HOLD_KNOWN);
    setHoldKnown(true);
  };
  const [connection, setConnection] = useState<{ from: string; side: Side; x: number; y: number; target?: string; anchor?: ManualAnchor } | null>(null);
  
  const [handle, setHandle] = useState<{ id: string; side: Side } | null>(null);
  const handleRef = useRef(handle);
  const showHandle = (h: { id: string; side: Side } | null) => {
    const was = handleRef.current;
    if (was?.id === h?.id && was?.side === h?.side) return;
    handleRef.current = h;
    setHandle(h);
  };
  const connectable = (item: Item) => item.source !== 'plan' && item.kind !== 'plan';
  
  
  const routeOf = (from: string, to: string, a: Bounds, b: Bounds, head: number) => {
    const anchor = byId(to)?.plan?.manualAnchors?.[from];
    return anchor ? anchoredPath(a, b, anchor, head).path : undefined;
  };
  
  const touchDots = (id: string) => touchy && !dragId && (touchFocus === id || selection.includes(id));
  
  const connectFrom = useCallback((id: string, side: Side, clientX: number, clientY: number) => {
    const p = toWorld(camRef.current, clientX, clientY);
    setConnection({ from: id, side, ...p });
  }, []);
  const cardBoxes = useMemo(() => placed.flatMap(({ item, b }) => (item.kind === 'plan' ? [] : [b])), [placed]);
  const titleOf = (id: string) => {
    const i = byId(id);
    return clip(i ? plain(i.title) || titleFrom(i.body) || t.titlePlaceholder : '…', 50);
  };
  
  const [depKnown, setDepKnown] = useState(() => known(DEP_KNOWN));
  
  
  const [removing, setRemoving] = useState<{ key: string; sent?: true }[]>([]);
  
  const pendingRemovals = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; send: (keepalive?: boolean) => void }>());
  
  useEffect(() => {
    const away = () => {
      for (const p of pendingRemovals.current.values()) {
        clearTimeout(p.timer);
        p.send(true);
      }
      pendingRemovals.current.clear();
    };
    addEventListener('pagehide', away);
    return () => removeEventListener('pagehide', away);
  }, []);
  /** A removal still waiting for "Undo" to run out is taken back: the arrow stays. */
  function keepDependency(key: string) {
    const p = pendingRemovals.current.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    pendingRemovals.current.delete(key);
    setRemoving((r) => r.filter((x) => x.key !== key));
  }
  
  
  const lassoRef = useRef<Pos[] | null>(null);
  const [lasso, setLasso] = useState<Pos[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const marked = selection.filter((id) => placed.some((p) => p.item.id === id));
  
  const [markKnown, setMarkKnown] = useState(() => known(MARK_KNOWN));
  const [moveKnown, setMoveKnown] = useState(() => known(MOVE_MARKED_KNOWN));
  const [markHint, setMarkHint] = useState<{ at: Pos; key: number } | null>(null);
  useEffect(() => {
    if (!marked.length || markKnown) return;
    know(MARK_KNOWN);
    setMarkKnown(true);
    setMarkHint(null);
  }, [marked.length]);
  useEffect(() => {
    if (!markHint) return;
    const h = setTimeout(() => setMarkHint(null), 7000);
    
    const hide = () => setMarkHint(null);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('wheel', hide, true);
    return () => {
      clearTimeout(h);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('wheel', hide, true);
    };
  }, [markHint]);
  const [ring, setRing] = useState<{ at: Pos; ids: string[]; kind: RightClick } | null>(null);
  
  const [rightClick, setRightClick] = useState<RightClick>('groups');
  const markedBox = unionBounds(placed.filter((p) => marked.includes(p.item.id)).map((p) => p.b));
  /** Where the line for what is marked stands: over its top right corner, below it where the bar leaves no room, always in view. */
  const markedAt = (b: Bounds) => {
    const c = cam;
    const top = c.y + b.y * c.s;
    const below = top < TOP + MARKED_ROOM;
    const y = below ? c.y + (b.y + b.h) * c.s : top;
    const side = sideNow();
    return { at: { x: Math.min(innerWidth - side.right - 12, Math.max(side.left + MARKED_W, c.x + (b.x + b.w) * c.s)), y: Math.min(innerHeight - MARKED_ROOM, Math.max(TOP + MARKED_ROOM, y)) }, below };
  };
  async function assignGroup(to: { group: string | null } | { name: string }) {
    const r = ring!;
    setRing(null);
    
    const one = r.ids.length === 1 ? placed.find((p) => p.item.id === r.ids[0])?.b : undefined;
    growFrom(r.ids, one ? centre(one) : toWorld(camRef.current, r.at.x, r.at.y));
    try {
      if ('name' in to) await api.createGroup(to.name, r.ids);
      else await api.assign(r.ids, to.group);
    } catch (e) {
      fail(e);
    }
  }
  /** The trash button on an owner-drawn arrow: it goes at once, with "Undo". */
  function removeDependency(from: string, to: Item) {
    const key = `${from}:${to.id}`;
    if (!(to.queue && 'behind' in to.queue && to.queue.behind.includes(from))) {
      
      setRemoving((r) => [...r, { key, sent: true }]);
      api.dependency(from, to.id, true).then(
        () =>
          showAck(t.deps.removed, () => {
            setRemoving((r) => r.filter((x) => x.key !== key));
            api.dependency(from, to.id).catch(fail);
          }),
        (e) => {
          setRemoving((r) => r.filter((x) => x.key !== key));
          fail(e);
        },
      );
      return;
    }
    setRemoving((r) => [...r, { key }]);
    const send = (keepalive = false) => {
      setRemoving((r) => r.map((x) => (x.key === key ? { key, sent: true } : x)));
      api.dependency(from, to.id, true, keepalive).catch((e) => {
        setRemoving((r) => r.filter((x) => x.key !== key));
        fail(e);
      });
    };
    const timer = setTimeout(() => {
      pendingRemovals.current.delete(key);
      send();
    }, ACK_MS);
    pendingRemovals.current.set(key, { timer, send });
    showAck(t.deps.removed, () => keepDependency(key));
  }
  
  useEffect(() => {
    const drawn = new Set(placed.flatMap(({ item }) => (item.plan?.manualDependsOn ?? []).map((from) => `${from}:${item.id}`)));
    if (removing.some((x) => x.sent && !drawn.has(x.key))) setRemoving((r) => r.filter((x) => !x.sent || drawn.has(x.key)));
  }, [placed, removing]);
  /** The × on a group's name in the colour ring: its cards belong to none, with a moment to undo. */
  async function deleteGroup(g: Group) {
    setRing(null);
    try {
      const gone = await api.deleteGroup(g.id);
      showAck(t.groups.removed(g.name), () => api.createGroup(gone.group.name, gone.cards, gone.group.hue));
    } catch (e) {
      fail(e);
    }
  }
  /** A right click on a card opens the colour ring for it (a workstream's is its plan's), on a marked one for all marked. */
  function onContextMenu(e: React.MouseEvent) {
    
    if (touchyRef.current) return e.preventDefault();
    if (focusRef.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.item');
    let i = el && byId(el.dataset.id!);
    if (i?.parent) i = byId(i.parent);
    if (!i) return;
    e.preventDefault();
    setRing({ at: { x: e.clientX, y: e.clientY }, ids: marked.includes(i.id) ? marked : [i.id], kind: rightClick });
  }
  /** The ring of canvases: the cards it is for go onto the canvas picked (a plan with its workstreams), with "Undo" back to the canvases they were on. */
  async function moveRing(to: Canvas) {
    const r = ring!;
    setRing(null);
    const from = r.ids.map((id) => [id, byId(id)?.canvas ?? canvases[0]?.id] as const);
    try {
      await api.moveToCanvas(r.ids, to.id);
      const names = r.ids.length === 1 ? plain(byId(r.ids[0]!)?.title ?? '') || titleFrom(byId(r.ids[0]!)?.body ?? '') : t.canvases.cards(r.ids.length);
      showAck(t.canvases.moved(names, canvasText(to)), () => Promise.all([...new Set(from.map(([, c]) => c))].map((c) => c && api.moveToCanvas(from.filter(([, x]) => x === c).map(([id]) => id), c))).then(() => {}));
    } catch (err) {
      fail(err);
    }
  }
  
  const side = sideNow();
  const quickSide = useRef(0);
  useEffect(() => {
    const from = camSide.current;
    if (side.left === from.left && side.right === from.right) return;
    camSide.current = side;
    
    if (focusRef.current?.type === 'card') return;
    const to = kept(besideSheet(camRef.current, from, side));
    if (resizing || Date.now() < quickSide.current) {
      stopFlight();
      setCam(to);
    } else fly(to, 450);
  }, [side.left, side.right]);
  
  
  useEffect(() => {
    const i = openId && itemOrArchived(openId);
    if (i && unfolded.current) fitPanel(i);
  }, [side.left, side.right, dock.active, ptt.phase]);

  /** `c`, moved just far enough that the view outside the sheet shows some content. */
  const kept = (c: Cam) => keepInView(c, contentRef.current, viewNow());
  /** The view at the current zoom with a world point in the middle, as far as content stays in sight. */
  const viewOn = (wx: number, wy: number) => kept({ s: camRef.current.s, x: midX(sideNow()) - wx * camRef.current.s, y: innerHeight / 2 - wy * camRef.current.s });
  /** When no content is in view any more (cards went, the window shrank), flies to the nearest. */
  const recover = () => {
    if (focusRef.current?.type === 'card' || dragRef.current || panRef.current || touchesRef.current?.busy || flying()) return;
    const c = camRef.current;
    const k = kept(c);
    if (k.x !== c.x || k.y !== c.y) fly(k, 400);
  };
  useEffect(recover, [content, tick]);

  function onPointerDown(e: React.PointerEvent) {
    if (focusRef.current?.type === 'card' || e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    if (touch !== touchyRef.current) {
      touchyRef.current = touch;
      setTouchy(touch);
    }
    if (connection) {
      e.stopPropagation();
      
      const conn = touch ? aimed(connection, e.clientX, e.clientY) : connection;
      const { from, side } = conn;
      const start = placed.find((p) => p.item.id === from)?.b;
      
      if (!conn.target && start && !(e.target as Element).closest('.item, .plan-dir, button')) {
        
        const startAt = handleAt(start, side), at = toWorld(camRef.current, e.clientX, e.clientY);
        const [w, h] = CARD_SIZE.task, dx = at.x - startAt.x, dy = at.y - startAt.y;
        const across = Math.abs(dx) * h >= Math.abs(dy) * w;
        const toSide: Side = across ? (dx < 0 ? 'right' : 'left') : (dy < 0 ? 'bottom' : 'top');
        const centre = across ? { x: at.x + Math.sign(dx || 1) * w / 2, y: at.y } : { x: at.x, y: at.y + Math.sign(dy) * h / 2 };
        createAt(centre, { made: (card) => api.dependency(from, card.id, false, false, { fromSide: side, toSide, offset: 0.5 }).catch((err) => showAck(failText(err))) })
          .catch(console.error);
        if (!depKnown) {
          know(DEP_KNOWN);
          setDepKnown(true);
        }
      } else if (conn.target) {
        
        if (pendingRemovals.current.has(`${conn.from}:${conn.target}`)) keepDependency(`${conn.from}:${conn.target}`);
        else {
          const { target, anchor } = conn;
          api.dependency(from, target, false, false, anchor).catch((err) => showAck(err instanceof ApiError && err.code === 'dependencyCycle' ? t.deps.cycle(titleOf(from), titleOf(target)) : failText(err)));
        }
        if (!depKnown) {
          know(DEP_KNOWN);
          setDepKnown(true);
        }
      }
      setConnection(null);
      setTouchFocus(null);
      return;
    }
    stopFlight();
    if (touch) {
      
      e.preventDefault();
      if (!touchesRef.current!.busy) touchEl.current = e.target as Element;
      touchesRef.current!.down(e.pointerId, { x: e.clientX, y: e.clientY }, touchTarget(e.target as Element));
      viewportRef.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (grab(e.target as Element, e.clientX, e.clientY, e.shiftKey)) {
      
      if (e.shiftKey) e.preventDefault();
    } else if (e.shiftKey) {
      
      e.preventDefault();
      lassoRef.current = [{ x: e.clientX, y: e.clientY }];
      setLasso(lassoRef.current);
    } else {
      panRef.current = { x: e.clientX, y: e.clientY, from: { x: e.clientX, y: e.clientY } };
      setPanning(true);
    }
    viewportRef.current!.setPointerCapture(e.pointerId);
  }

  /** A card or plan the keyboard reached outside the view: the camera brings it in, as it does a card being opened. */
  function onCanvasFocus(e: React.FocusEvent) {
    const el = (e.target as Element).closest<HTMLElement>('.item');
    const i = el && onControl(e.target) && !focusRef.current ? byId(el.dataset.id!) : undefined;
    if (!el || !i) return;
    const r = el.getBoundingClientRect();
    const v = viewNow();
    if (r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom) return;
    const b = bounds(i);
    fly(viewOn(b.x + b.w / 2, b.y + Math.min(b.h, innerHeight / 2 / camRef.current.s) / 2), 400);
  }

  /** What a finger landed on, for touch.ts: a card or a plan's head by its id, a plan directory's note, or null for the empty project. */
  function touchTarget(target: Element) {
    const note = target.closest<HTMLElement>('.plan-dir');
    if (note) return `note:${note.dataset.repo}`;
    const el = target.closest<HTMLElement>('.item');
    return el && (!el.classList.contains('plan') || target.closest('.head')) ? el.dataset.id! : null;
  }

  /** Takes hold of the card or note under the pointer at (x, y), ready to be dragged; false when there is none there. */
  function grab(target: Element, x: number, y: number, shift: boolean) {
    const el = target.closest<HTMLElement>('.item');
    const note = target.closest<HTMLElement>('.plan-dir');
    if (note) {
      
      const repo = note.dataset.repo!;
      const r = note.getBoundingClientRect();
      const start = toWorld(camRef.current, r.left, r.top);
      const b = notes[planDirs!.findIndex((d) => d.repo === repo)]!;
      const content = unionBounds(placed.map((p) => p.b)) ?? b;
      const grab = toWorld(camRef.current, x, y);
      dragRef.current = { id: `note:${repo}`, note: repo, with: [], shift: false, x, y, px: x, py: y, grab, start, limit: dragLimit(content, b), moved: false, frame: 0, last: 0 };
      return true;
    }
    if (el && (!el.classList.contains('plan') || target.closest('.head'))) {
      const i = byId(el.dataset.id!);
      if (!i) return true;
      
      const along = movesWith(marked, i.id).flatMap((id) => {
        const x = byId(id);
        return x ? [{ id, start: { x: x.x, y: x.y } }] : [];
      });
      const moving = new Set([i.id, ...along.map((a) => a.id)]);
      
      const rest = onProject(itemsRef.current.filter(onShown)).filter((x) => !moving.has(x.id));
      const b = unionBounds([...moving].map((id) => bounds(byId(id)!)))!;
      const content = unionBounds(rest.map((x) => boundsOf(x, rest))) ?? b;
      const grab = toWorld(camRef.current, x, y);
      dragRef.current = { id: i.id, with: along, shift, x, y, px: x, py: y, grab, start: { x: i.x, y: i.y }, limit: dragLimit(content, b), moved: false, frame: 0, last: 0 };
      return true;
    }
    return false;
  }

  /** The held card comes off the project and follows the pointer, the view scrolling at the edges. */
  function lift(d: Drag) {
    setDragId(d.id);
    setDragWith(d.with.map((w) => w.id));
    d.moved = true;
    d.frame = requestAnimationFrame(edgeTick);
  }

  /** Puts the dragged card under the pointer. */
  function place(d: Drag) {
    const w = toWorld(camRef.current, d.px, d.py);
    let p = { x: Math.round(d.start.x + w.x - d.grab.x), y: Math.round(d.start.y + w.y - d.grab.y) };
    if (d.note) {
      d.to = p;
      return setNotesMoved((m) => ({ ...m, [d.note!]: p }));
    }
    
    if (byId(d.id)?.parent) p = { x: Math.max(PLAN_PAD, p.x), y: Math.max(PLAN_HEAD, p.y) };
    const by = { x: p.x - d.start.x, y: p.y - d.start.y };
    setMoved((m) => ({ ...m, [d.id]: p, ...shifted(d.with, by) }));
  }

  /** While a card is dragged, scrolls the view when the pointer is near an edge. */
  function edgeTick(now: number) {
    const d = dragRef.current;
    if (!d) return;
    const ms = d.last ? Math.min(50, now - d.last) : 0;
    d.last = now;
    const c = camRef.current;
    const side = sideNow();
    const view = { left: side.left, top: TOP, right: innerWidth - side.right, bottom: innerHeight };
    const next = edgeScroll(c, { x: d.px, y: d.py }, { x: d.x, y: d.y }, view, d.limit, ms);
    if (next.x !== c.x || next.y !== c.y) {
      setCam(next);
      place(d);
    }
    d.frame = requestAnimationFrame(edgeTick);
  }

  /** The arrow being drawn, aimed at the pointer at (x, y): at the card there, if any. */
  function aimed(conn: NonNullable<typeof connection>, x: number, y: number): NonNullable<typeof connection> {
    const p = toWorld(camRef.current, x, y);
    const near = placed.filter(({ item }) => item.id !== conn.from && connectable(item)).map(({ item, b }) => ({ id: item.id, area: b.w * b.h, d: Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.w), Math.max(b.y - p.y, 0, p.y - b.y - b.h)) })).filter((x) => x.d <= 8 / camRef.current.s).sort((a, b) => a.d - b.d || a.area - b.area)[0];
    
    const target = near && placed.find((x) => x.item.id === near.id);
    const edge = target && nearestEdge(target.b, p);
    return { ...conn, x: p.x, y: p.y, target: near?.id, anchor: edge ? { fromSide: conn.side, toSide: edge.side, offset: edge.offset } : undefined };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (connection) {
      setConnection(aimed(connection, e.clientX, e.clientY));
      return;
    }
    if (e.pointerType === 'touch') {
      touchesRef.current!.move(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    
    const busy = lassoRef.current || dragRef.current || panRef.current || focusRef.current?.type === 'card';
    if (busy) showHandle(null);
    else {
      const c = camRef.current;
      const near = placed.flatMap(({ item, b }) => (connectable(item) ? [{ id: item.id, b }] : []));
      
      showHandle(nearestHandle(near, toWorld(c, e.clientX, e.clientY), 16 / c.s, 6 / c.s));
    }
    if (lassoRef.current) {
      lassoRef.current = [...lassoRef.current, { x: e.clientX, y: e.clientY }];
      setLasso(lassoRef.current);
      return;
    }
    const d = dragRef.current;
    if (d) {
      d.px = e.clientX;
      d.py = e.clientY;
      if (!d.moved && Math.hypot(d.px - d.x, d.py - d.y) < 5) return;
      if (!d.moved) lift(d);
      place(d);
      return;
    }
    
    const p = panRef.current;
    if (!p) return;
    const c = camRef.current;
    setCam(kept({ ...c, x: c.x + e.clientX - p.x, y: c.y + e.clientY - p.y }));
    p.x = e.clientX;
    p.y = e.clientY;
  }

  function onPointerUp(e: React.PointerEvent) {
    if (e.pointerType === 'touch') return touchesRef.current!.up(e.pointerId, { x: e.clientX, y: e.clientY });
    const l = lassoRef.current;
    if (l) {
      lassoRef.current = null;
      setLasso([]);
      endLasso(l);
      return;
    }
    const d = dragRef.current;
    if (d) {
      endDrag(d, { x: e.clientX, y: e.clientY });
      return;
    }
    const p = panRef.current;
    panRef.current = null;
    setPanning(false);
    
    if (p && Math.hypot(e.clientX - p.from.x, e.clientY - p.from.y) < 5) setSelection([]);
  }

  function onPointerCancel(e: React.PointerEvent) {
    if (e.pointerType === 'touch') touchesRef.current!.cancel(e.pointerId, { x: e.clientX, y: e.clientY });
    else onPointerUp(e);
  }

  /** What a finished lasso (screen points) caught is marked; one that went nowhere is a click. */
  function endLasso(l: Pos[]) {
    const c = camRef.current;
    
    if (l.every((p) => Math.hypot(p.x - l[0]!.x, p.y - l[0]!.y) < 5)) {
      const el = document.elementFromPoint(l[0]!.x, l[0]!.y)?.closest<HTMLElement>('.item');
      const i = el && byId(el.dataset.id!);
      if (i) setSelection((sel) => toggle(sel, markable(i)));
      return;
    }
    
    const ids = [...new Set(placed.filter(({ b }) => inside({ x: c.x + (b.x + b.w / 2) * c.s, y: c.y + (b.y + b.h / 2) * c.s }, l)).map(({ item }) => markable(item)))];
    setSelection((sel) => addAll(sel, ids));
  }

  /** The dragged card is let go at `at` (screen): where it lies now is saved; one that never moved was clicked. */
  function endDrag(d: Drag, at: Pos) {
    cancelAnimationFrame(d.frame);
    dragRef.current = null;
    setDragId(null);
    setDragWith([]);
    const repo = d.note;
    if (repo) {
      if (d.moved && d.to)
        api.movePlanDirNote(repo, d.to).catch((err) => {
          console.error(err);
          setNotesMoved(({ [repo]: _, ...rest }) => rest);
        });
      return;
    }
    const i = byId(d.id);
    if (!i) return;
    
    if (d.moved && (i.x !== d.start.x || i.y !== d.start.y)) {
      for (const x of [i, ...d.with.flatMap((w) => byId(w.id) ?? [])])
        patchCard(x.id, { x: x.x, y: x.y }).catch((err) => {
          console.error(err);
          setMoved(({ [x.id]: _, ...rest }) => rest);
        });
      if (d.with.length && !moveKnown) {
        know(MOVE_MARKED_KNOWN);
        setMoveKnown(true);
      }
      if (!d.with.length && !markKnown) setMarkHint({ at, key: Date.now() });
    } else if (d.moved) return;
    else if (d.shift) setSelection((sel) => toggle(sel, markable(i)));
    else open(i);
  }

  function onDoubleClick(e: React.MouseEvent) {
    
    if (!touchyRef.current) newCardAt(e.clientX, e.clientY);
  }

  /** A double-click or double-tap on empty canvas creates a card in the territory at that point. */
  function newCardAt(x: number, y: number) {
    
    if (focusRef.current || document.elementFromPoint(x, y)?.closest('.item, .plan-dir')) return;
    const at = toWorld(camRef.current, x, y);
    const group = groupAt(viewportRef.current!, at, groups);
    createAt(at, { group }).catch(fail);
  }

  
  const touchHost: ConstructorParameters<typeof Touches>[0] = {
    pan: (dx, dy) => {
      const c = camRef.current;
      setCam(kept({ ...c, x: c.x + dx, y: c.y + dy }));
    },
    pinch: (from, to) => setCam(kept(pinchCam(camRef.current, from, to))),
    tap: (_, target) => {
      
      if (!target) {
        setSelection([]);
        setTouchFocus(null);
        return;
      }
      const i = target.startsWith('note:') ? undefined : byId(target);
      if (!i) return;
      
      if (marked.length) setSelection((sel) => toggle(sel, markable(i)));
      else {
        setTouchFocus(null);
        open(i);
      }
    },
    doubleTap: (at) => newCardAt(at.x, at.y),
    hold: (at, target) => {
      buzz();
      learnHold();
      setTouchFocus(null);
      if (!target) {
        lassoRef.current = [at];
        setLasso(lassoRef.current);
      } else if (touchEl.current && grab(touchEl.current, at.x, at.y, false) && dragRef.current) lift(dragRef.current);
    },
    holdMove: (at) => {
      if (lassoRef.current) {
        lassoRef.current = [...lassoRef.current, at];
        setLasso(lassoRef.current);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      d.px = at.x;
      d.py = at.y;
      place(d);
    },
    holdEnd: (at, cut) => {
      const l = lassoRef.current;
      if (l) {
        lassoRef.current = null;
        setLasso([]);
        if (!cut) endLasso(l);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      endDrag(d, at);
      
      if (!d.note) setTouchFocus(d.id);
    },
    moving: setPanning,
  };
  touchesRef.current ??= new Touches(touchHost);
  touchesRef.current.host = touchHost;

  useEffect(() => {
    const vp = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (focusRef.current?.type === 'card') return;
      stopFlight();
      const c = camRef.current;
      if (e.ctrlKey || e.metaKey) {
        const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.s * Math.exp(-e.deltaY * 0.012)));
        setCam(kept({ s, x: e.clientX - (e.clientX - c.x) * (s / c.s), y: e.clientY - (e.clientY - c.y) * (s / c.s) }));
      } else setCam(kept({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [setCam]);

  
  
  const yours = (i: Item) => needsYou(i) && !underwayRef.current[i.id];
  
  
  const here = waitingIn({ ...snapshot, items, talk: kOn ? [] : snapshot.talk });
  const entries = inboxEntries(projects, { ...waiting, [snapshot.project.id]: here }, (id) => !!underway[id]);
  
  useSwitcherFeed(waitingPerProject(entries), cOn || prefsOn || perfOn || phoneOn || newProjectOn);
  
  const queued = queueOrder(items).length;
  
  const needsYouCards = needsYouCount(entries);
  
  const openEntry = openId ? entries.find((e) => e.card?.id === openId && e.project === snapshot.project.id) : undefined;
  useEffect(() => {
    if (openEntry) inboxRead.markRead(openEntry);
  }, [openEntry && readMark(openEntry)]);
  
  const unread = kOn ? 0 : unreadAnswers(snapshot.talk);
  const nav = {
    project: snapshot.project,
    projects,
    pinned,
    pinnable: !matchMedia(NARROW).matches && innerWidth - navWidth - side.right >= NAV_PROJECT_MIN,
    onPin: pin,
    onNew: () => (setPrefsOn(false), setCOn(false), setNewProjectOn(true)),
  };
  /** A one-click reply in the inbox: the entry leaves at once, a held one waits out "Undo", a refused one comes back with the reason. */
  const replyTo = (c: string, i: Item, r: QuickReply) =>
    sendReply(c, i, r, {
      mark: (id, what) => setUnderway(({ [id]: _, ...rest }) => (what === null ? rest : { ...rest, [id]: what })),
      showAck,
    });
  const doneCount = items.filter((i) => i.source === 'manual' && finished(i.state)).length;
  async function archiveDone() {
    const { ids } = await api.archiveDone();
    if (ids.length) ratePrompt.ask(ids);
    if (ids.length) showAck(t.archive.archivedMany(ids.length), () => Promise.all(ids.map((id) => unarchiveCard(id))));
  }
  const attnLast = useRef<string | null>(null);
  
  /** What Tab goes through from the project: the cards that need the owner in their order on it, then Seismic's unread answer. */
  function attention(): (Item | 'k')[] {
    const koordinator = !kOnRef.current && unreadAnswers(snapshotRef.current.talk) > 0;
    return [...itemsRef.current.filter(yours), ...(koordinator ? ['k' as const] : [])];
  }
  const hasAttention = () => attention().length > 0;
  function nextAttention() {
    const all = itemsRef.current;
    const list = attention();
    if (!list.length || focusRef.current?.type === 'card') return;
    
    const key = (x: Item | 'k') => (x === 'k' ? 'k' : x.id);
    const at = (id: string | null) => (id === 'k' ? all.length : all.findIndex((i) => i.id === id));
    const last = at(attnLast.current);
    const next = list.find((x) => at(key(x)) > last) ?? list[0]!;
    attnLast.current = key(next);
    if (next === 'k') toggleKoordinator('answer');
    else open(next);
  }
  /** "Needs you" slides out in place of another sheet, and closes again. */
  const toggleNeedsYou = () => {
    const open = !nyOnRef.current;
    setNyOn(open);
    if (!open) return;
    setKOn(false);
    if (focusRef.current?.type === 'plan') closePlan(false);
  };
  /** The project's settings slide out in place of another sheet, and close again. */
  const toggleProjectSettings = () => {
    const open = !csOnRef.current;
    setCsOn(open);
    if (!open) return;
    setKOn(false);
    if (focusRef.current?.type === 'plan') closePlan(false);
  };
  /** Opens the project settings of `f.project` at a field: on this page, or on that project's, which it switches to. */
  const openSettingsAt = (f: SettingsFocus) => {
    if (f.project !== snapshot.project.id)
      
      return leave(() => {
        showSettingsAt(f);
        goTo(projectPath(f.project));
      });
    showSettingsAt(f);
    setCOn(false);
    if (!csOnRef.current) toggleProjectSettings();
  };
  
  useEffect(() => {
    if (settingsFocusWaits(snapshot.project.id) && !csOnRef.current) toggleProjectSettings();
  }, []);
  /** The agents slide out in place of another sheet, and close again. */
  const toggleAgents = () => {
    const open = !agentsOnRef.current;
    setAgentsOn(open);
    if (!open) return;
    setKOn(false);
    if (focusRef.current?.type === 'plan') closePlan(false);
  };
  const openCardId = (focus?.type === 'card' ? focus.id : openId) ?? undefined;
  
  const menu = {
    ...nav,
    
    onInbox: () => {},
    inbox: {
      entries, current: snapshot.project.id, open: openCardId, onGo: goToEntry, onReply: replyTo, isRead: inboxRead.isRead, onRead: inboxRead.markRead, els: inboxEls,
      onProposalCard: (project: string, card: Item) => goToEntry({ project, card }),
      onProposalConfig: (project: string, repo: string, setting: string) => openSettingsAt({ project, repo, section: sectionOfSetting(setting), field: setting as SettingsFocus['field'] }),
    },
    onPerformance: openPerformance,
    onFeedbackLog: () => location.assign(feedbackLogPath(snapshot.project.id)),
    canvases,
    canvas: canvasId,
    onCanvas: (c: Canvas) => {
      if (aOnRef.current) setAOn(false);
      showPage(null);
      if (focusRef.current?.type === 'plan') closePlan();
      showCanvas(c);
    },
    onQueue: () => showPage('queue'),
    onParked: () => showPage('parked'),
    onArchived: () => setAOn(true),
    onProjectSettings: () => !csOnRef.current && toggleProjectSettings(),
    showing: aOn ? ('archived' as const) : fullPage.active === 'parked' || fullPage.active === 'queue' ? fullPage.active : csOn ? ('settings' as const) : undefined,
    onConfig: toggleConfig,
    onPrefs: openPrefs,
    onHelp: () => {
      setHelpNote(undefined);
      setHelpOn(true);
    },
  };
  /**
   * "Go to card": the card unfolds over the inbox's view (or beside "Needs you"), which stays open;
   * one on another project opens there, the inbox's view open under it again. Seismic's answer opens its sheet.
   */
  function goToEntry(e: Pick<InboxEntry, 'project' | 'card'>) {
    if (e.project !== snapshot.project.id) return goTo(e.card ? cardPath(e.project, e.card) : `${projectPath(e.project)}?talk=answer`);
    if (!e.card) return kOnRef.current || toggleKoordinator('answer');
    
    void openFresh(byId(e.card.id) ?? e.card);
  }
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const f = focusRef.current;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
    
    if (e.target instanceof Element && e.target.closest('#project-switcher')) return;
    
    if (typing && (e.target as Element).closest('[data-esc]')) return;
    
    if (e.key === 'Escape' && layerOpen()) return;
    
    if (e.key === 'Escape' && e.target instanceof Element && e.target.closest('[data-esc-back]')) return;
    
    if (e.target instanceof Element && e.target.closest('[role=menu], [data-slot=popover-content]')) return;
    
    if (cOnRef.current) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setCOn(false);
      }
      return;
    }
    
    if (prefsOn) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPrefsOn(false);
      }
      return;
    }
    
    if (perfOn) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPerfOn(false);
      }
      return;
    }
    
    if (phoneOn) {
      if (e.key === 'Escape') setPhoneOn(false);
      return;
    }
    
    if (wishOn) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeWish();
      }
      return;
    }
    
    if (helpOn) {
      if (e.key === 'Escape' || e.key === '?') setHelpOn(false);
      
      if (e.key === 'Escape' || e.key === '?' || e.code === 'Space') e.preventDefault();
      return;
    }
    if (e.key === '/' && !typing && !focusRef.current && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
      e.preventDefault();
      closeBarMenus();
      searchField.current?.focus();
      return;
    }
    if (e.key === '?' && !typing) {
      e.preventDefault();
      setHelpNote(helpKnown ? undefined : 'gone');
      setHelpOn(true);
      if (!helpKnown) {
        know(HELP_KEY_KNOWN);
        setHelpKnown(true);
      }
      return;
    }
    
    if (e.code === 'Space' && !typing) {
      
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (link instanceof HTMLAnchorElement && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) link.click();
        return;
      }
      
      if (e.target instanceof Element && e.target.closest('[role=switch], [role=checkbox], [role=radio], [role=menu], [aria-haspopup=menu], .app-logo, [data-space-activates]')) return;
      
      if (e.target instanceof Element && e.target.closest('button, summary, input[type=button], input[type=submit], input[type=file], [role=button], [role=tab], [role=option], [role=menuitem]')) return;
      e.preventDefault();
      if (!e.repeat) press(true);
      return;
    }
    if (e.key === 'Escape' && connection) { setConnection(null); return; }
    if (e.key === 'Escape') {
      
      if (document.querySelector('.lightbox, .demo-zoom, .artifact-image-close')) return;
      
      const quoting = [focusedDraft(), f?.type === 'card' || f?.type === 'plan' ? cardDraft(f.id) : null, kOnRef.current ? SEISMIC_DRAFT : null].find((k) => k && fieldOn(k) && replyOn(k));
      if (quoting) return setReply(quoting, null);
      
      if (!f && fullPage.ref.current) {
        if (fullPage.ref.current === 'archive') setAOn(false);
        else fullPage.show(null);
        return;
      }
      if (f?.type !== 'card' && aOnRef.current) return setAOn(false);
      
      if (f?.type !== 'card' && !typing && !ring && marked.length) return setSelection([]);
      if (typing) (e.target as HTMLElement).blur();
      if (f?.type === 'card') closeCard();
      else dock.escape();
      return;
    }
    if (typing || f?.type === 'card' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '0') {
      setFocus(null);
      setSheetOn(false);
      fly(kept(overviewCam(all, sideNow())), 700);
    } else if (e.key === 'Tab' && !e.shiftKey && !onControl(e.target) && hasAttention()) {
      
      e.preventDefault();
      nextAttention();
    } else if (e.key === 'n' || e.key === 'c' || e.key === 'a') {
      
      e.preventDefault();
      if (e.key === 'n') createAtCentre();
      else if (e.key === 'c') talkKoordinator();
      else setAOn(!aOnRef.current);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
  }, []);

  
  const moveRef = useRef(moveCard);
  moveRef.current = moveCard;
  const canvasView = useMemo(() => ({ canvases, shown: canvasId, move: (i: Item, to: Canvas) => void moveRef.current(i, to) }), [canvases, canvasId]);
  const sheetPlan = sheetId ? itemOrArchived(sheetId) : undefined;
  const sheetKids = !sheetPlan ? [] : sheetPlan.archivedAt ? archived.filter((i) => i.parent === sheetPlan.id) : (kidsOf.get(sheetPlan.id) ?? []);
  
  const hovered = touchy ? touchFocus : hoverId;
  
  
  const effective = useMemo(() => {
    if (!removing.length) return items;
    const gone = new Set(removing.map((x) => x.key));
    return items.map((i) => {
      const drawn = i.plan?.manualDependsOn?.filter((from) => !gone.has(`${from}:${i.id}`));
      const q = i.queue;
      const held = q && 'behind' in q ? q.behind.filter((from) => !(q.manualWait?.includes(from) && gone.has(`${from}:${i.id}`))) : undefined;
      const same = drawn?.length === i.plan?.manualDependsOn?.length && (!q || !('behind' in q) || held!.length === q.behind.length);
      if (same) return i;
      return {
        ...i,
        ...(i.plan && drawn && { plan: { ...i.plan, manualDependsOn: drawn } }),
        ...(q && 'behind' in q && { queue: { ...q, behind: held! } }),
      };
    });
  }, [items, removing]);
  const deps = useMemo(() => (hovered && !panning && !dragId ? depsOf(hovered, effective) : undefined), [hovered, panning, dragId, effective]);
  const waits = useMemo(() => waitsAmong(effective), [effective]);
  const settled = useMemo(() => settledAmong(effective), [effective]);
  const waitKeys = useMemo(() => new Set([...waits, ...settled.map((d): [string, string] => [d.from, d.to])].map(([from, to]) => `${from}:${to}`)), [waits, settled]);
  
  const onShownCanvas = ([from, to]: [string, string]) => !hiddenCard(from, byId) && !hiddenCard(to, byId);
  const shownSettled = settled.filter((d) => onShownCanvas([d.from, d.to]));
  const shownWaits = waits.filter(onShownCanvas);
  
  const lineKeys = useMemo(
    () => new Set(withoutImplied([...shownWaits, ...shownSettled.map((d): [string, string] => [d.from, d.to])]).map(([from, to]) => `${from}:${to}`)),
    [waits, settled, removing],
  );
  const lineWaits = shownWaits.filter(([from, to]) => lineKeys.has(`${from}:${to}`));
  const lineSettled = shownSettled.filter((d) => lineKeys.has(`${d.from}:${d.to}`));
  const standsForId = (id: string) => (byId(id) ? standsFor(byId(id)!).id : id);
  
  const placedAt = new Map(placed.map((p) => [p.item.id, p.b]));
  
  const stubs = [
    ...(canvases.length > 1 ? stubsOf(lineWaits, new Set(placedAt.keys()), byId, standsForId, canvases, canvasId) : []),
    ...(deps ? parkedStubsOf(deps.edges, new Set(placedAt.keys()), byId, standsForId) : []),
  ];
  const depOf = (id: string) => (!deps ? undefined : id === hovered ? 'self' : deps.before.has(id) ? 'before' : deps.after.has(id) ? 'after' : undefined);
  
  const at = new Map(placed.map((p) => [p.item.id, p.b]));
  const edgeTargets = items.flatMap((item) => {
    const b = at.get(standsFor(item).id);
    return b && !offCanvas(item) && yours(item) && (focus?.type !== 'plan' || item.parent === focus.id) ? [{ item, b }] : [];
  });

  
  
  
  
  
  const switched: SwitchedView | null = fullPage.active === 'parked' || fullPage.active === 'table' ? fullPage.active : fullPage.active ? null : 'canvas';
  const switchTo = (v: SwitchedView) => {
    if (focusRef.current?.type === 'plan') closePlan();
    showPage(v === 'canvas' ? null : v);
  };
  const talkButton = (
    <Tooltip content={t.koordinator.buttonTitle}>
      <PillButton size="bar" tone="ink" on={kOn} className="px-3" aria-label={t.koordinator.button} onClick={talkKoordinator}>
        <TalkIcon />
        {unread > 0 && (
          <Badge variant="count" tone="waiting" title={t.koordinator.unreadCount(unread)}>
            {unread}
          </Badge>
        )}
      </PillButton>
    </Tooltip>
  );

  const planComponent = () => (
    <Sheet
      planCard={sheetPlan}
      kids={sheetKids}
      all={items}
      on={sheetOn}
      reading={reading}
      onOpen={open}
      onRead={(r) => sheetPlan && readPlan(sheetPlan, r)}
      onStartAll={startAll}
      onArrange={arrange}
      els={sheetEls}
      version={snapshot}
    />
  );
  
  const dockViews: DockView[] = [
    { id: 'needs-you', besideCard: true, title: t.needsYou.title, icon: ConciergeBell, component: () => (<NeedsYouSheet on={nyOn} entries={entries} current={snapshot.project.id} open={openCardId} onGo={goToEntry} onReply={replyTo} isRead={inboxRead.isRead} onRead={inboxRead.markRead} />) },
    { id: 'agents', besideCard: true, title: t.agents.title, icon: Bot, component: () => (<AgentsSheet on={agentsOn} items={items} open={openId ?? undefined} underway={isUnderway} onOpen={openFreshCard} project={snapshot.project.id} changed={snapshot} onGo={(project, card) => goToEntry({ project, card })} />) },
    { id: 'settings', besideCard: true, title: t.projectSettings.title, icon: SlidersHorizontal, component: () => (<ProjectSettingsSheet project={snapshot.project.id} name={snapshot.project.name} homePath={snapshot.project.repos[0]?.path} onAddSite={() => (showAddSite(), setPrefsOn(false), setCOn(true))} on={csOn} covered={cOn} />) },
    { id: 'seismic', besideCard: true, title: t.koordinator.title, icon: MessageSquare, buttonCloses: true, component: () => (<KoordinatorSheet on={kOn} onClose={() => toggleKoordinator()} entry={chatEntry.current} project={snapshot.project.id} projectName={snapshot.project.name} items={items} preferences={snapshot.preferences} settings={snapshot.settingProposals ?? []} repos={snapshot.project.repos} talk={snapshot.talk} chat={snapshot.chat} chatModel={snapshot.chatModel} chats={snapshot.chats} reshare={snapshot.reshare} onOpen={(i) => void openFresh(i)} onTell={tellChat} onProject={(c) => goTo(`${projectPath(c)}?talk`)} onConfig={(repo, setting) => openSettingsAt({ project: snapshot.project.id, repo, section: sectionOfSetting(setting), field: setting as SettingsFocus['field'] })} />) },
    { id: 'plan', slot: 'plan', title: sheetPlan?.title ?? '', icon: Columns3, close: () => void closePlan(), component: planComponent },
    { id: 'plan-doc', slot: 'plan', title: sheetPlan?.title ?? '', icon: FileText, width: 'read', close: () => void closePlan(), escape: () => { if (sheetPlan) void readPlan(sheetPlan, null); }, component: planComponent },
  ];
  dock.register(dockViews);
  return (
    <HoldToTalk.Provider value={holdToTalk}>
    <OpenPerformance.Provider value={openPerformance}>
    <KoordinatorAgent.Provider value={snapshot.koordinatorAgent}>
    <Canvases.Provider value={canvasView}>
      <FullPageHost
        
        className={[cam.s < FAR && 'z-far', resizing && 'resizing cursor-ew-resize! select-none [&_*]:cursor-ew-resize! [&_*]:select-none'].filter(Boolean).join(' ') || undefined}
        style={
          {
            '--sheet-w': `${sheetW.sheet}px`,
            '--read-w': `${sheetW.read}px`,
            '--side': `${side.right}px`,
            '--left': `${side.left}px`,
          } as React.CSSProperties
        }
      >
        <div
          id="viewport"
          ref={viewportRef}
          className={[
            'fixed inset-0 touch-none bg-transparent bg-[radial-gradient(var(--dot)_1px,transparent_1px)]',
            panning ? 'panning cursor-grabbing' : 'cursor-grab',
            
            
            
            ring && '[&_*]:[animation-play-state:paused]! [&_*::before]:[animation-play-state:paused]! [&_*::after]:[animation-play-state:paused]!',
            
            touchy && 'touch select-none [-webkit-touch-callout:none]',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ backgroundSize: `${22 * cam.s}px ${22 * cam.s}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onFocus={onCanvasFocus}
        >
          <div id="world" className="absolute top-0 left-0 origin-top-left will-change-transform" style={{ transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.s})` }}>
            <TerritoryLayer {...territories} selected={placed.filter((p) => (ring ? ring.ids : marked).includes(p.item.id)).map((p) => p.b)} />
            <Links placed={placed} waits={[...shownWaits, ...shownSettled.map((d): [string, string] => [d.from, d.to])]} standsFor={standsForId} />
            <DepLinks placed={placed} waits={lineWaits} lit={(deps?.edges ?? []).filter(onShownCanvas)} first={deps?.first} settled={lineSettled} standsFor={standsForId} routeOf={routeOf} s={cam.s}>
              {
}
              {placed.flatMap(({ item, b }) => (connectable(item) ? item.plan?.manualDependsOn ?? [] : []).filter((from) => waitKeys.has(`${from}:${item.id}`) && !removing.some((x) => x.key === `${from}:${item.id}`)).flatMap((from) => {
                const a = placed.find((p) => p.item.id === from && connectable(p.item))?.b;
                if (!a) return [];
                const r = 13 / cam.s;
                
                const anchor = item.plan?.manualAnchors?.[from];
                const routed = anchor && anchoredPath(a, b, anchor, depHead(cam.s));
                const { x, y } = routed ? routed.mid : linkSpot(a, b, depHead(cam.s), cardBoxes, r);
                
                const shown = touchy && (touchFocus === from || touchFocus === item.id);
                return [<g className="group/edge" key={`${from}:${item.id}`}>
                  <path className="fill-none stroke-transparent [pointer-events:stroke]" d={routed ? routed.path : linkPath(a, b, depHead(cam.s))} strokeWidth={22 / cam.s} />
                  <foreignObject x={x - r} y={y - r} width={2 * r} height={2 * r} className={cn('overflow-visible', shown ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none group-hover/edge:opacity-100 group-hover/edge:pointer-events-auto group-focus-within/edge:opacity-100 group-focus-within/edge:pointer-events-auto')}><Tooltip content={t.deps.remove}><button className={manualRemoveClass} aria-label={t.deps.remove} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); removeDependency(from, item); }}><Trash2 strokeWidth={2} /></button></Tooltip></foreignObject>
                </g>];
              }))}
              <CanvasStubs stubs={stubs} boundsOf={(id) => placedAt.get(id)} s={cam.s} onOpen={(i) => void openFresh(i)} />
            </DepLinks>
            <svg className={cn(depLayerClass, 'z-3 [&_marker_path]:fill-waiting')} width="1" height="1">
              <defs><marker id="manual-arrow" viewBox="0 0 9 8" refX="0.3" refY="4" markerWidth={6} markerHeight={(6 * 8) / 9} markerUnits="strokeWidth" orient="auto"><path d="M0,0 L9,4 L0,8 z" /></marker><marker id="ghost-arrow" viewBox="0 0 9 8" refX="9" refY="4" markerWidth={6} markerHeight={(6 * 8) / 9} markerUnits="strokeWidth" orient="auto"><path d="M0,0 L9,4 L0,8 z" /></marker></defs>
              {connection && (() => { const a = placed.find((p) => p.item.id === connection.from)?.b; if (!a) return null; const start = handleAt(a, connection.side); const b = placed.find((p) => p.item.id === connection.target)?.b; const path = b ? (connection.anchor ? anchoredPath(a, b, connection.anchor, depHead(cam.s)).path : linkPath({ ...start, w: 0, h: 0 }, b, depHead(cam.s))) : `M${start.x},${start.y} L${connection.x},${connection.y}`; return <path className="fill-none stroke-waiting opacity-55 [stroke-dasharray:7_5]" d={path} strokeWidth={depWidth(cam.s)} markerEnd={b ? "url(#manual-arrow)" : "url(#ghost-arrow)"} />; })()}
            </svg>
            {placed.map(({ item, b }) =>
              item.kind === 'plan' ? (
                <PlanView key={item.id} item={item} b={b} kids={kidsOf.get(item.id) ?? []} replies={repliesIn.get(item.id) ?? 0} els={els} onStartAll={startAll} onArrange={arrange} onCollapse={collapse} onOpen={openCard} />
              ) : (
                <CardView
                  key={item.id}
                  item={item}
                  partner={item.idea?.proposal?.merge ? itemById.get(item.idea.proposal.merge.with) ?? archived.find((i) => i.id === item.idea!.proposal!.merge!.with) : undefined}
                  b={b}
                  lifted={item.id === openId}
                  dragging={item.id === dragId || dragWith.includes(item.id)}
                  pop={item.id === popId}
                  prototyped={prototyped.has(item.id)}
                  showRepo={snapshot.project.repos.length > 1}
                  els={els}
                  onStart={startCard}
                  onArchive={archiveOnCanvas}
                  dep={depOf(item.id)}
                  underway={underway[item.id] ?? (item.review?.landing ? t.approving : undefined)}
                  onHover={setHoverId}
                  onOpen={openCard}
                />
              ),
            )}
            {placed.filter(({ item }) => connectable(item)).map(({ item, b }) => {
              const states = cardHooks(item, underway[item.id]).replace(/^card\s*/, '');
              const lit = connection ? null : touchDots(item.id) ? 'all' : handle?.id === item.id ? handle.side : null;
              return <CardHandles key={`handles:${item.id}`} id={item.id} x={b.x} y={b.y} w={b.w} h={b.h} states={states} colour={handleColour(states, !!depOf(item.id))} target={connection?.target === item.id} lit={lit} onConnect={connectFrom} />;
            })}
            {planDirs?.map((d, n) => (
              <PlanDirNote
                key={d.repo}
                dir={d}
                b={notes[n]!}
                dragging={dragId === `note:${d.repo}`}
                {...(snapshot.project.repos.length > 1 ? { repo: snapshot.project.repos.find((r) => r.id === d.repo)?.name ?? d.repo } : {})}
                onPrepare={preparePlanDoc}
                onOpen={(id) => {
                  const i = byId(id);
                  if (i) open(i).catch(console.error);
                }}
                onChange={() => openSettingsAt({ project: snapshot.project.id, repo: d.repo ?? snapshot.project.repos[0]?.id, section: 'git', field: 'planDocs' })}
                onHide={() => hideNote(d)}
              />
            ))}
            <GroupNames shapes={territories.shapes} />
          </div>
        </div>
        { }
        {!placed.length && (
          <div
            className={cn(
              'empty pointer-events-none fixed top-1/2 left-[calc(50%+(var(--left,0px)-var(--side,0px))/2)] text-center whitespace-nowrap text-muted-foreground',
              notes.length ? '[transform:translate(-50%,-100%)]' : '[transform:translate(-50%,-50%)]',
            )}
            {...(notes.length ? { style: { top: cam.y + Math.min(...notes.map((b) => b.y)) * cam.s - 48 } } : {})}>
            <p className="m-0 mb-2">{t.empty.none}</p>
            <p className="m-0 mt-1">{t.empty.speak}</p>
            <p className="m-0 mt-0.5 mb-2.5 text-sm">{t.empty.where}</p>
            <p className="m-0 mt-1">{coarse || touchy ? t.touch.emptyTap : t.empty.click}</p>
          </div>
        )}
        {!ring && <Lasso pts={lasso} />}
        {markedBox && !ring && !dragId && !lasso.length && focus?.type !== 'card' && (
          <Marked
            {...markedAt(markedBox)}
            count={marked.length}
            {...(!moveKnown && marked.length > 1 ? { hint: touchy ? t.touch.move : t.marked.move } : {})}
            onGroup={(at) => setRing({ at, ids: marked, kind: 'groups' })}
          />
        )}
        {markHint && <MarkHint key={markHint.key} at={markHint.at} text={touchy ? t.touch.markHowTo : t.marked.howTo} />}
        {(coarse || touchy) && !holdKnown && !!items.length && !focus && (
          <p id="touchhint" className="fixed z-30 top-[82px] left-[calc(var(--left)_+_(100vw_-_var(--left)_-_var(--side))_/_2)] [transform:translateX(-50%)] flex items-center gap-3 max-w-[min(520px,calc(100vw_-_40px))] m-0 py-2 pr-2 pl-3.5 rounded-xs bg-foreground text-background font-sans text-base/[1.35] [box-shadow:var(--lift)]">
            {t.touch.hold}
            <button className="flex-none py-1.5 px-3 border border-background/40 rounded-xs bg-transparent text-inherit [font:inherit] cursor-pointer" onClick={learnHold}>{t.touch.ok}</button>
          </p>
        )}
        {connection && !depKnown && (
          <p id="dephint" className={cn(hintBubbleClass, 'fixed z-40 pointer-events-none [transform:translate(16px,16px)] animate-[fade_.15s_ease-out]')} style={{ left: cam.x + connection.x * cam.s, top: cam.y + connection.y * cam.s }}>
            {connection.target ? t.deps.waits(titleOf(connection.from), titleOf(connection.target)) : (touchy ? t.touch.pick : t.deps.pick)(titleOf(connection.from))}
          </p>
        )}
        {ring?.kind === 'canvases' && <CanvasRing at={ring.at} count={ring.ids.length} canvases={canvases} shown={canvasId} onPick={(c) => void moveRing(c)} onClose={() => setRing(null)} />}
        {ring?.kind === 'groups' && (
          <Ring
            at={ring.at}
            count={ring.ids.length}
            groups={groups}
            open={openPerGroup(snapshot.items)}
            onPick={(group) => assignGroup({ group })}
            onCreate={(name) => assignGroup({ name })}
            onDelete={deleteGroup}
            onClose={() => setRing(null)}
          />
        )}
        {(!focus || focus.type === 'plan') && <Edges cam={cam} targets={edgeTargets} side={side} onOpen={open} />}
        { }
        <header
          id="bar"
          ref={barRef}
          className={cn(
            'group/bar frost-bar fixed top-0 right-[var(--side,0px)] left-[var(--left,0px)] z-25 box-border grid h-[50px] grid-cols-[1fr_minmax(150px,440px)_1fr] items-center gap-3.5 border-b border-border px-3.5 transition-[right,left,padding-left] duration-450 ease-[cubic-bezier(.3,.9,.3,1)] resizing:transition-none data-[fit~="3"]:grid-cols-[auto_minmax(34px,440px)_auto]',
            window.seismicApp?.platform === 'macos' && !side.left && 'pl-23',
          )}
          {...(window.seismicApp?.platform === 'macos' ? { 'data-tauri-drag-region': '' } : {})}
        >
          <div className="left flex items-center gap-2.5">
            {extensions.map((e, i) => { const Slot = e.slots?.topBar; return Slot ? <Slot key={i} /> : null; })}
            <MenuButton {...menu} docked={pinned && nav.pinnable} dockedOn={side.left > 0} onDocked={showDocked} />
          </div>
          <CardSearch items={items} field={searchField} hidden={!!focus} onOpen={(item) => void openFresh(item)} />
          <div className="right flex items-center justify-end gap-2.5">
            {oldBun && <OldBunPill version={oldBun} />}
            {online && update && restart?.reason !== 'update' && <UpdatePill update={update} />}
            {online && source && <SourcePill source={source} />}
            {!helpKnown && (
              <HelpButton
                on={helpOn}
                onClick={() => {
                  setHelpNote('button');
                  setHelpOn(!helpOn);
                }}
              />
            )}
            {!kOn && (
              <div className="invisible" aria-hidden>
                {talkButton}
              </div>
            )}
            { }
            <Tooltip content={t.avatar}>
              <span className="grid size-[34px] place-items-center text-muted-foreground" aria-label={t.avatar} role="img">
                <CircleUserRound size={22} strokeWidth={1.75} aria-hidden />
              </span>
            </Tooltip>
          </div>
        </header>
        { }
        <div
          id="floating-row"
          ref={rowRef}
          className={cn('group/row pointer-events-none fixed top-[58px] right-[calc(var(--side,0px)+14px)] left-[calc(var(--left,0px)+48px)] z-24 flex items-center gap-2.5 transition-[right,left] duration-450 ease-[cubic-bezier(.3,.9,.3,1)] resizing:transition-none [&>*]:pointer-events-auto')}
        >
          {!side.left && <NavPill {...nav} />}
          <div className="right ml-auto flex flex-none items-center gap-2.5 [&>*]:pointer-events-auto">
            <Tooltip content={t.projectSettings.button}>
              <PillButton size="bar" on={csOn} className="px-2.5 [&_[data-variant=count]]:ml-1" aria-label={t.projectSettings.button} aria-expanded={csOn} onClick={toggleProjectSettings}>
                <BarIcon icon={SlidersHorizontal} />
                {configProblems > 0 && (
                  <Badge variant="count" tone="destructive" title={t.config.problemCount(configProblems)}>
                    {configProblems}
                  </Badge>
                )}
              </PillButton>
            </Tooltip>
            { }
            <div className="flex rounded-full shadow-glass hover:shadow-lift">
              <Tooltip content={t.agents.button(queued)}>
                <PillButton size="bar" on={agentsOn} tone="ink" className="rounded-none rounded-l-full pl-3.5 shadow-none hover:shadow-none" aria-label={t.agents.button(queued)} aria-expanded={agentsOn} aria-pressed={agentsOn} onClick={toggleAgents}>
                  <BarIcon icon={Bot} />
                  {queued > 0 && <Badge variant="count">{queued}</Badge>}
                </PillButton>
              </Tooltip>
              <Tooltip content={t.needsYou.button(needsYouCards)}>
                <PillButton
                    size="bar"
                    on={nyOn}
                    tone="ink"
                    className="rounded-none rounded-r-full border-l-border px-3 pr-3.5 shadow-none hover:shadow-none"
                    id="attention" aria-label={t.needsYou.button(needsYouCards)}
                    aria-expanded={nyOn}
                    aria-pressed={nyOn}
                    onClick={() => {
                      if (!needsYouKnown) {
                        know(NEEDS_YOU_KNOWN);
                        setNeedsYouKnown(true);
                      }
                      toggleNeedsYou();
                    }}
                >
                  <BarIcon icon={ConciergeBell} />
                  {!needsYouKnown && <span className="font-semibold group-data-[fit~='2']/row:hidden">{t.needsYou.label}</span>}
                  {needsYouCards > 0 && <Badge variant="count" tone="waiting">{needsYouCards}</Badge>}
                </PillButton>
              </Tooltip>
            </div>
          </div>
        </div>
        <ArchiveView on={aOn} onClose={() => setAOn(false)} held={focus?.type === 'card'} archived={archived} done={doneCount} onOpen={open} onArchiveDone={() => archiveDone().catch(console.error)} els={archiveEls} />
        <ParkedView on={fullPage.active === 'parked'} items={items} open={openCardId} underway={isUnderway} onOpen={openFreshCard} onClose={() => showPage(null)} els={parkedEls} />
        <TableView on={fullPage.active === 'table'} project={snapshot.project.id} items={items} canvases={canvases} groups={snapshot.groups} repos={snapshot.project.repos} open={openCardId ?? (focus?.type === 'plan' ? focus.id : undefined)} onOpen={(i) => void openFresh(i)} onClose={() => showPage(null)} els={tableEls} />
        <QueueView on={fullPage.active === 'queue'} items={items} onOpen={(i) => void openFresh(i)} onClose={() => showPage(null)} />
        { }
        <footer
          id="status"
          className={cn('frost-bar fixed right-[var(--side,0px)] bottom-0 left-[var(--left,0px)] z-45 grid h-[34px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3.5 border-t border-border px-2.5 text-sm transition-[right,left] duration-450 ease-[cubic-bezier(.3,.9,.3,1)] resizing:transition-none', dim && 'z-29')}
        >
          <div className="flex min-w-0 items-center">
            {!online || frozen ? <ConnectionLost since={downSince} frozen={frozen} /> : restart ? <RestartPill restart={restart} items={items} project={snapshot.project.id} onOpen={(i) => void openFresh(i)} /> : <span className={cn(statusWord, 'text-success')}>{t.online}</span>}
            {online && snapshot.project.demoSite?.init?.running && <span className={statusWord}>{t.creatingSite}</span>}
          </div>
          <div />
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            {snapshot.workstations && <WorkstationsPill pools={snapshot.workstations} project={snapshot.project} projects={projects} items={items} underway={underway} onOpen={(i) => void openFresh(i)} onElsewhere={(c, card) => goTo(cardPath(c, card))} onTake={takeWorkstation} onKeep={keepWorkstation} />}
            {snapshot.workstations && online && usage.some((u) => u.limits.length > 0) && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border/60" />}
            {online && usage.map((u) => <UsagePill key={u.harness} usage={u} />)}
          </div>
        </footer>
        <NavSheet on={side.left > 0} onOpenChange={showDocked} width={navWidth} maxWidth={innerWidth - side.right - NAV_PROJECT_MIN} onWidthChange={setNavWidth} onWidthEnd={saveNavWidth} onResizing={dock.setResizing} {...menu} />
        <Minimap
          cam={cam}
          side={side}
          all={all}
          placed={placed}
          territories={territories.shapes}
          onJump={(wx, wy) => !focusRef.current && fly(viewOn(wx, wy), 500)}
          onFollow={(wx, wy) => !focusRef.current && chase(camRef.current, viewOn(wx, wy), setCam)}
        />
        <CanvasTabs project={snapshot.project.id} canvases={canvases} shown={canvasId} waiting={perCanvas.waiting} empty={perCanvas.empty} onDeleteError={fail} onShow={(c) => (focusRef.current?.type === 'plan' && closePlan(), showPage(null), showCanvas(c))} onRename={renamedCanvas} />

        { }
        <div id="dim" className={cn('fixed inset-x-0 top-[50px] bottom-0 z-30 bg-scrim opacity-0 pointer-events-none [transition:opacity_.2s,left_0s]', dim && 'on opacity-100 pointer-events-auto backdrop-blur-[3px]')} onClick={() => closeCard()} />
        {helpOn && <Help note={helpNote} onClose={() => setHelpOn(false)} />}
        <WishDialog />
        {


}
        <div
          id="panel"
          ref={panelRef}
          tabIndex={-1}
          className="group/panel outline-none fixed z-40 overflow-hidden hidden frost-pane [&:not(.ready)]:bg-surface [&:not(.ready)]:backdrop-filter-none [&.anim]:[--ease:cubic-bezier(.3,.9,.3,1)] [&.anim]:transition-[left,top,width,height] [&.anim]:duration-(--unfold) [&.anim]:ease-(--ease) before:content-[''] before:absolute before:left-[30px] before:w-20 before:top-0 before:h-[3px] before:rounded-b-xs before:bg-(--c) before:shadow-[0_0_12px_var(--c)] before:z-1"
        >
          {openItem && (
            <div className="invisible absolute right-3.5 top-3 z-2 group-[.ready]/panel:visible">
              <CardMore key={openItem.id} item={openItem} onClose={() => closeCard()} />
            </div>
          )}
          {
}
          <div className="inner card-sheet [--pb:26px] absolute left-0 top-0 bottom-0 w-full overflow-auto [scrollbar-gutter:stable] pt-6 px-8 pb-(--pb) opacity-0 transition-opacity duration-[120ms] group-[.ready]/panel:opacity-100" ref={innerRef}>
            { }
            <div className="content flow-root [&>:first-child]:pr-6 [&>:last-child]:mb-0">
              {openItem && (
                <Cards.Provider value={{ items, open: (i) => void openFresh(i) }}>
                <Detail
                  key={openItem.id}
                  item={openItem}
                  all={[...new Map([...items, ...archived, ...items.flatMap((i) => i.plan?.manualArchived ?? [])].map((i) => [i.id, i])).values()]}
                  repos={snapshot.project.repos}
                  parent={openItem.parent ? itemOrArchived(openItem.parent) : undefined}
                  from={openItem.from ? itemOrArchived(openItem.from) : undefined}
                  onReadPlan={(plan, mark) => readPlan(plan, { mark })}
                  onClones={(repo, field) => {
                    
                    openSettingsAt({ project: snapshot.project.id, repo, section: 'agents', field });
                  }}
                  onDemoSites={() => {
                    
                    closeCard();
                    if (!csOnRef.current) toggleProjectSettings();
                  }}
                  onEdit={onEdit}
                  flush={flushEdit}
                  onDelete={deleteOpen}
                  panelMenu
                  onDone={onDone}
                  onTell={(text, images, field, replyTo) => tellTyped(text, images, { card: openItem.id }, field, replyTo)}
                />
                </Cards.Provider>
              )}
            </div>
          </div>
        </div>
        <ConfigDialog
          on={cOn}
          usage={online ? usage : []}
          onClose={() => setCOn(false)}
          onTalk={talkFromConfig}
          onConnect={() => (setCOn(false), setPhoneOn(true))}
          onProjectSettings={() => {
            setCOn(false);
            if (!csOnRef.current) toggleProjectSettings();
          }}
        />
        <NewProjectDialog open={newProjectOn} onClose={() => setNewProjectOn(false)} />
        <PrefsDialog
          preferences={snapshot.preferences} repos={snapshot.project.repos}
          on={prefsOn}
          onClose={() => setPrefsOn(false)}
          onConfig={() => {
            setPrefsOn(false);
            setCOn(true);
          }}
        />
        {phoneOn && (
          <PhoneDialog
            onClose={() => setPhoneOn(false)}
            onSection={() => {
              setPhoneOn(false);
              showDevicesSection();
              setCOn(true);
            }}
          />
        )}

        <PushToTalk
          phase={ptt.phase}
          level={ptt.level}
          flat={ptt.flat}
          target={target}
          field={draftFor(where())}
          onDown={() => press(false)}
          instead={<ViewSwitcher shown={switched} onShow={switchTo} />}
          behind={dim}
        />

        {
}
        <div id="talk-docked" className={cn('fixed top-[9px] right-[calc(var(--side,0px)+14px+34px+10px)] z-27 [transition:right_.45s_cubic-bezier(.3,.9,.3,1)] resizing:[transition:none]', kOn && 'on right-[14px] hidden [@media(max-width:760px)]:top-[74px] [@media(max-width:760px)]:right-[22px]')}>
          {talkButton}
        </div>
        <DockShell dock={dock} />
        { }
        <div id="acks" className={acksClass}>
          <Cards.Provider value={{ items, open: (i) => void openFresh(i) }}>
            <Toasts toasts={toasts} open={focus?.type === 'card' ? focus.id : undefined} />
          </Cards.Provider>
          { }
          {ratePrompt.prompt}
          <NotifyAsk {...notifyAsk} />
        </div>
        <ConfirmDialog
          open={!!manualStart}
          onOpenChange={(open) => !open && setManualStart(null)}
          title={t.queue.confirmManualStartTitle}
          confirm={{ label: t.queue.force, onClick: () => { if (manualStart) void startCardNow(manualStart.item); } }}
          cancel={t.queue.confirmManualStartBack}
        >
          <p>{manualStart && t.queue.confirmManualStart(manualStart.names)}</p>
        </ConfirmDialog>
        <PerformanceDialog initial={perfAtStart} on={perfOn} onClose={() => setPerfOn(false)} projects={projects} here={snapshot.project.id} onOpenCard={(code) => void openNamed(code).catch(console.error)} />
      </FullPageHost>
    </Canvases.Provider>
    </KoordinatorAgent.Provider>
    </OpenPerformance.Provider>
    </HoldToTalk.Provider>
  );
}

/**
 * Where the unfolded card sits: in the middle of the project between the panels `side`, reaching over
 * the sheet where the project is too narrow for it, except the `keep` px at the right edge that a
 * sheet usable beside the card holds (the card lies under that sheet where even those do not fit),
 * as tall as its content needs up to a limit, beyond which it scrolls. Lays the content out at the
 * final width to measure it, so call it with the content rendered.
 */
function panelRect(i: Item, inner: HTMLElement, side: Sides, keep = 0) {
  const tall = i.state !== 'planned' && i.state !== 'proposal';
  
  const wide = split(i);
  
  const want = wide ? 1600 : talkAlone(i) ? TALK_W : tall ? 980 : 900;
  
  
  
  const room = innerWidth - side.left - keep - 80;
  const W = Math.min(want, Math.max(room, Math.min(TALK_W, innerWidth - side.left - 80)));
  inner.style.width = `${W}px`;
  inner.style.removeProperty('--pb');
  inner.style.overflowY = '';
  const pad = getComputedStyle(inner);
  const base = parseFloat(pad.paddingBottom);
  const content = inner.firstElementChild as HTMLElement;
  
  const height = (e: HTMLElement) => e.getBoundingClientRect().height;
  
  
  const ptt = document.getElementById('ptt');
  const micShown = ptt && (!ptt.classList.contains('switching') || document.getElementById('mic'));
  const mic = (micShown ? ptt.getBoundingClientRect().top : innerHeight) - MIC_GAP;
  
  
  const fill = content.querySelector<HTMLElement>('.split');
  if (fill) {
    fill.style.minHeight = fill.style.maxHeight = '';
    if (!matchMedia(NARROW).matches) {
      const rest = height(content) - height(fill) + parseFloat(pad.paddingTop) + base;
      const room = Math.floor(mic - PANEL_TOP_OVER - rest);
      fill.style.minHeight = `${SPLIT_MIN}px`;
      fill.style.maxHeight = `${Math.max(SPLIT_MIN, room)}px`;
      
      if (room >= SPLIT_MIN) inner.style.overflowY = 'hidden';
    }
  }
  const need = height(content) + parseFloat(pad.paddingTop) + base;
  
  
  const toMic = Math.floor(mic - PANEL_TOP_OVER);
  const max = Math.min(fill ? Infinity : Math.max(toMic, SPLIT_MIN), innerHeight - PANEL_TOP_OVER - PANEL_BOTTOM);
  
  
  
  const top = (H: number) => Math.max(PANEL_TOP_OVER, Math.min(Math.max(PANEL_TOP, (innerHeight - H) / 2), innerHeight - PANEL_BOTTOM - H, mic - H));
  
  
  const under = (H: number) => Math.max(0, top(H) + H - mic - base);
  let H = Math.min(Math.ceil(need), max);
  H = Math.min(Math.ceil(need + under(H)), max);
  const extra = under(H);
  
  if (extra) inner.style.setProperty('--pb', `${base + extra}px`);
  
  
  const lo = side.left + 40;
  return { left: `${Math.max(lo, Math.min(midX(side) - W / 2, innerWidth - keep - W - 40))}px`, top: `${top(H)}px`, width: `${W}px`, height: `${H}px` };
}


const TALK_W = 640;

const NARROW = '(max-width: 760px)';


const PANEL_TOP = 102;

const PANEL_TOP_OVER = 62;

const PANEL_BOTTOM = 14;

const SPLIT_MIN = 320;


const MIC_GAP = 12;

const rect = (r: DOMRect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });

/** Camera centred on the middle of `b` at scale `s` between the panels `side`, ignoring the top bar (the unfold is centred there too). */
const centreOnPoint = (b: Bounds, s: number, side: Sides): Cam => ({ s, x: midX(side) - (b.x + b.w / 2) * s, y: innerHeight / 2 - (b.y + b.h / 2) * s });

/** State with a ref that holds the value set last, for what reads it before the next render. */
function useLive<T>(init: T | (() => T)): [T, (v: T) => void, { readonly current: T }] {
  const [v, setV] = useState(init);
  const ref = useRef(v);
  const set = useCallback((n: T) => {
    ref.current = n;
    setV(n);
  }, []);
  return [v, set, ref];
}

/** A button's icon in the top bar, shown in place of its label where the bar is narrow (beside a wide sheet). */
function BarIcon({ icon: I }: { icon: LucideIcon }) {
  return <I className="block" size={16} strokeWidth={2} aria-hidden />;
}


const statusWord = 'rounded-full px-2.5 py-1 font-semibold whitespace-nowrap';

