import { clientExtensions as extensions } from '../extensions/client';
// The project: camera, drag, unfold-in-place and the plan sheet.

import { useRatePrompt } from './feedback';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Archive, Bot, Inbox as Inbox2, Search, type LucideIcon, Settings, Trash2 } from 'lucide-react';
import { type Bounds, boundsOf, CARD_SIZE, centre, onProject, type Place, PLAN_HEAD, PLAN_PAD, unionBounds } from '../core/layout';
import { type RightClick, type Canvas, canvasNamedBy, MAIN_CANVAS, type ProjectInfo, type ProjectSnapshot, type CardPatch, type ConfigProblem, finished, type Group, type Item, nameless, withPart, needsYou, openPerGroup, type PendingRestart, type PlanDir, EVICT_HOLD_MS, START_ALL_HOLD_MS, titleFrom, type AppUpdate, type SourceUpdate, unreadAnswers, unreadPerPlan, type Usage, type Waiting, waitingIn, inParkingLot } from '../core/types';
import { NotifyAsk, useDesktopNotifications } from './desktopNotify';
import { api, ApiError, beforeReload, onNotice, quietAtStart, reportFocus, setProject, useProject } from './api';
import { GroupNames, growFrom, inside, Lasso, MarkHint, Marked, Ring, TerritoryLayer, useTerritories } from './groups';
import { buzz, pinchCam, TOUCH_HOLD_KNOWN, Touches } from './touch';
import { besideSheet, BOTTOM, type Cam, camFor, camKey, centreOn, chase, dragLimit, edgeScroll, FAR, flying, flyTo, keepInView, MAX_ZOOM, midX, MIN_ZOOM, NO_SIDES, overviewCam, placeIn, shows, type Sides, stopFlight, TOP, toWorld } from './camera';
import { plain } from './markdown';
import { CanvasRing, Canvases, CanvasStubs, CanvasTabs, stubsOf } from './canvases';
import { canvasText } from './canvasIcon';
import { clip } from '../core/text';
import { type ActDone, Detail, type Pending } from './detail';
import { Cards, KoordinatorAgent } from './message';
import { motionMs, reducedMotion, sizeSettled } from './motion';
import type { Heard, Where } from './api';
import { replyOn, setReply } from './reply';
import { ArchivePill } from './archive';
import { CardSearch } from './cardSearch';
import { useBarFit } from './barFit';
import { UsagePill } from './usage';
import { ConfigDialog, Problem, showAddSite, showProjectsSection, showDevicesSection, showNewProject, showRepoClones } from './config';
import { AppMenu, PrefsDialog } from './prefs';
import { PhoneDialog } from './access';
import { OpenPerformance, PerformanceDialog } from './performance';
import { FeedbackLog } from './feedbackLog';
import { LOG_KEYS, readLogQuery } from '../core/feedback-log';
import { Setup } from './setup';
import { Phone, phoneView } from './phone';
import { KoordinatorSheet } from './koordinator';
import { closeBarMenus, forcedText } from './queue';
import { queueOrder } from '../core/queue';
import { AgentsSheet } from './agents';
import { depsOf, handleAt, manualPrerequisites, nearestHandle, settledAmong, type Side, SIDES, waitsAmong } from './deps';
import { anchoredPath, nearestEdge } from './manualLinks';
import type { ManualAnchor } from '../core/types';
import { collect, inboxKept, keep, keepInbox, type Kept, leaveSheet, restore, type SideSheet, takeKept, takeSheetLeft } from './keep';
import { Sign } from './logo';
import { DOUBLE_CLICK_KNOWN, Help, HelpButton, HELP_KEY_KNOWN, NewCardHint } from './help';
import { know, known } from './known';
import { addAll, MARK_KNOWN, markable, MOVE_MARKED_KNOWN, movesWith, shifted, toggle } from './selection';
import { closeWish, keepWish, openWish, useWish, WishDialog } from './wish';
import { PlanDirNote, planDirBoxes, useHiddenEmptyNotes } from './planDirs';
import { pastedShots } from './pasteHint';
import { attachTo, imageFiles } from './shots';
import { cardDraft, drafted, fieldOn, focusedDraft, keepDrafts, MIC_DRAFT, OBEYA_DRAFT, takesImages } from './draft';
import { HoldToTalk, PushToTalk, SPACE_SHOWS_MS, TAP_MS, usePushToTalk, useTold } from './voice';
import { Toasts, useToasts } from './components/toast';
import { videoOf } from './spot';
import { cardClass, shownState } from './card';
import { CardView, DepLinks, depHead, depWidth, linkPath, linkSpot, Edges, Links, Minimap, minimapArea, OldBunPill, PlanView, RestartPill, Sheet, SourcePill, TalkIcon, UpdatePill, WorkstationsPill } from './parts';
import { clampWidth, loadWidths, saveWidths, SHEET_W, type SheetWidths, widthsIn } from './sheetWidth';
import { clock, failText, t } from './strings';
import { loadPinned, NAV_PROJECT_MIN, NAV_W, NavPill, NavSheet, savePinned } from './nav';
import { projectPath, cardPath, feedbackLogPath, followedPath, named, knowProjects, projectNamed, queryWithout, readAddress } from './address';
import { type QuickReply, sendReply } from './quickReply';
import { Inbox } from './inbox';
import { useInboxRead } from './inboxRead';
import { ProjectSettingsSheet } from './projectSettings';
import { type InboxEntry, inboxEntries, readMark, waitingCount } from '../core/inbox';
import { beingWritten, split, talkAlone } from './talk';
import { ACK_MS, noticeLine, tellers, useAck, useWarnings, voiceTarget } from './tell';

export function App() {
  const [phone] = useState(phoneView);
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
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
    // the app from the home screen while the machine sleeps: the phone view with the projects it had, which says that Seismic does not answer
    if (!phone) return;
    const h = setTimeout(() => setProjects((c) => c ?? keptProjects()), quietAtStart ? 0 : 3000);
    return () => clearTimeout(h);
  }, []);
  if (!projects) return <Splash offline={failed} />;
  // the project in the address, else the first
  const { project: wanted, page } = readAddress();
  knowProjects(projects);
  // an address with no address part opens the first; one naming no project says so, rather than showing another's cards
  const current = wanted ? projectNamed(projects, wanted) : projects[0];
  if (!projects.length) return <NoProject />;
  if (!current) return <NoSuchProject name={wanted!} projects={projects} />;
  // a phone gets every project's waits and work, and the cards full screen, instead of the project
  if (phone) return <Phone projects={projects} />;
  // the Agent Feedback Log, a page of its own in place of the project it was opened from
  if (page === 'feedback') return <FeedbackLog projects={projects} here={current.id} />;
  setProject(current.id);
  keepDrafts(sessionStorage, current.id);
  keepWish(sessionStorage, current.id);
  return <Live projects={projects} />;
}

/** An address names a project that does not exist (a renamed one's old address, a typo): the projects there are, as links. */
function NoSuchProject({ name, projects }: { name: string; projects: ProjectInfo[] }) {
  return (
    <div id="splash" className="none-runs">
      <Sign size={56} />
      <h2>{t.noSuchProject(name)}</h2>
      <ul>
        {projects.map((c) => (
          <li key={c.id}>
            <a className="link" href={projectPath(c.id)}>
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
  const [down, setDown] = useState<ConfigProblem[] | null>(null);
  const read = () => api.configCheck().then((c) => setDown(c.problems.filter((p) => p.code === 'projectDown')), () => setDown([]));
  useEffect(() => void read(), []);
  if (!down) return <Splash offline={false} />;
  if (!down.length) return <Setup first />;
  const retried = () =>
    void api.projects().then((list) => {
      if (list.length) location.reload();
      else void read();
    }, console.error);
  return (
    <div id="splash" className="none-runs">
      <Sign size={56} />
      <h2>{t.noneRuns}</h2>
      {down.map((p, k) => (
        <Problem key={k} problem={p} where="" retried={retried} />
      ))}
    </div>
  );
}

/** While the page loads, and after a restart until the project is back: the sign in the middle, above "offline" when the server cannot be reached. */
/** The projects the phone view last had, for when the machine does not answer. */
const KEPT_PROJECTS = 'obeya-phone-projects';
/** Set once the owner has drawn their first arrow between cards: what an arrow does no longer shows while drawing. */
const DEP_KNOWN = 'obeya-dep-known';
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

/** How long the server may stay silent before the bar names the time it went quiet. */
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
  return <span className="st offline">{text}</span>;
}

function Splash({ offline }: { offline: boolean }) {
  return (
    <div id="splash">
      <Sign size={56} />
      {offline && <div>{t.offline}</div>}
    </div>
  );
}

function Live({ projects: loaded }: { projects: ProjectInfo[] }) {
  const { snapshot, online, frozenSince, offlineSince, restart, update, source, usage, waiting, oldBun, projects } = useProject();
  if (!snapshot) return <Splash offline={!online} />;
  // a project started, stopped or renamed while the page is open: the switcher follows
  return <Project snapshot={snapshot} online={online} downSince={offlineSince ?? frozenSince} frozen={frozenSince !== null} restart={restart} update={update} source={source} usage={usage} projects={projects ?? loaded} waiting={waiting} oldBun={oldBun} />;
}

/** What is open, and the view to go back to: `prevCam` laid out beside the panels `prevSide`. */
type Focus = { type: 'plan'; id: string; prevCam: Cam; prevSide: Sides } | { type: 'card'; id: string; prevCam: Cam; prevSide: Sides; plan: Focus | null };
type Pos = { x: number; y: number };

// opening a card takes FLY_MS + UNFOLD_MS (300 ms) and closing the same: fast, yet still a visible move
const FLY_MS = 130;
/** The room the line for what is marked takes above or below the marked cards, and its least width. */
const MARKED_ROOM = 90;
const MARKED_W = 270;
const UNFOLD_MS = 170;
// under reduced motion, the open card waits hidden this long for its content to stop growing, at most the cap
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

/** Where the camera on a canvas is kept: the project's first canvas has the key the whole project had before it had several. */

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
  /** Since when the server answers nothing (connection lost or frozen); null while it does. */
  downSince: number | null;
  frozen: boolean;
  restart: PendingRestart | null;
  update: AppUpdate | null;
  source: SourceUpdate | null;
  /** The plan's usage limits, while the bar shows them. */
  usage: Usage | null;
  projects: ProjectInfo[];
  waiting: Record<string, Waiting>;
  /** The Bun the server runs on, when it is too old for it (docs/design/distribution.md, Builds). */
  oldBun: string | null;
}) {
  knowProjects(projects);
  // a rename of this project, or an address by an old name: it follows to the name now, keeping the card and query
  const shownAt = useRef<{ id: string; path: string } | null>(null);
  useEffect(() => {
    const to = followedPath(location.pathname, projects, snapshot.project.id, shownAt.current);
    shownAt.current = { id: snapshot.project.id, path: projectPath(snapshot.project.id) };
    if (to) history.replaceState(history.state, '', `${to}${location.search}${location.hash}`);
  }, [projects, snapshot.project.id]);
  // ---------------------------------------------------------------- items
  // Local positions win over the snapshot until the server echoes them back.
  const [moved, setMoved] = useState<Record<string, Pos>>({});
  // Plans collapsed or expanded here, until the server echoes it back.
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  // Cards created here, until the snapshot carries them.
  const [pending, setPending] = useState<Item[]>([]);
  // Approved cards the server is still landing, with what the card says meanwhile, until it moves on.
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
    // a card replied to from "Needs you" stays under way while it still waits for the owner, also one on another project
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
    // the snapshot may carry a new card before its creation answers: then it is there once
    const ids = new Set(snapshot.items.map((i) => i.id));
    const all = [...snapshot.items, ...pending.filter((i) => !ids.has(i.id))];
    return all.map((i) => {
      const at = moved[i.id] ? { ...i, ...moved[i.id] } : i;
      const c = folded[i.id];
      if (c === undefined) return at;
      return withPart(at, 'plan', { collapsed: c || undefined });
    });
  }, [snapshot, pending, moved, folded]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // ---------------------------------------------------------------- canvases
  // the canvas shown is the one the address's hash names (`#main`, `#2`), else the first; each has a layout of its own
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => {
      // a card open is shown on its own canvas: a hash naming another one goes
      const f = focusRef.current;
      const open = f?.type === 'card' ? itemsRef.current.find((i) => i.id === f.id) : undefined;
      const own = open && !open.archivedAt ? canvasesRef.current.find((c) => c.id === open.canvas) : undefined;
      if (own && canvasNamedBy(canvasesRef.current, location.hash)?.id !== own.id) history.replaceState(history.state, '', `${location.pathname}${location.search}#${encodeURIComponent(own.name)}`);
      setHash(location.hash);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const canvases = useMemo(() => snapshot.canvases ?? [], [snapshot.canvases]);
  const canvasesRef = useRef(canvases);
  canvasesRef.current = canvases;
  // a hash that names no canvas keeps the one shown before: a canvas just made or renamed here is
  // named in the address before the project brings it under that name
  const lastShown = useRef<string>(undefined);
  const shownCanvas = (hash ? canvasNamedBy(canvases, hash) : undefined) ?? canvases.find((c) => c.id === lastShown.current) ?? canvases[0];
  const canvasId = shownCanvas?.id;
  lastShown.current = canvasId;
  const canvasRef = useRef(canvasId);
  canvasRef.current = canvasId;
  /** Shows a canvas of the project (one just made too, which the project brings soon); the address names it. */
  const showCanvas = (c: Canvas | string) => {
    const to = typeof c === 'string' ? canvases.find((x) => x.id === c) : c;
    if (!to) return;
    const h = `#${encodeURIComponent(to.name)}`;
    if (to.id === canvasRef.current && location.hash === h) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${h}`);
    flushSync(() => setHash(h));
  };
  // the address names the canvas by its name, which reordering does not change: `#2` as the page
  // opens becomes the name of the second, and a hash that names none goes
  useEffect(() => {
    if (!location.hash || !canvases.length) return;
    const named = canvasNamedBy(canvases, location.hash);
    const h = named ? `#${encodeURIComponent(named.name)}` : '';
    if (h === location.hash) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${h}`);
    setHash(h);
  }, []);
  // per canvas, the cards waiting for the owner, and which canvases have none at all (those can go)
  const perCanvas = useMemo(() => {
    const waiting: Record<string, number> = {};
    const used = new Set<string>();
    for (const i of items) {
      if (inParkingLot(i)) continue;
      const c = i.canvas ?? canvases[0]?.id;
      if (!c) continue;
      used.add(c);
      if (needsYou(i)) waiting[c] = (waiting[c] ?? 0) + 1;
    }
    return { waiting, empty: new Set(canvases.filter((c) => !used.has(c.id)).map((c) => c.id)) };
  }, [items, canvases]);
  /** Whether the card is on the canvas shown (one the server has not placed on any yet counts as on the first). */
  const onShown = useCallback((i: Item) => !canvasId || (i.canvas ?? canvases[0]?.id) === canvasId, [canvasId, canvases]);
  // the workstreams of a collapsed plan are not on the project: its marks stand for them
  const placed = useMemo(() => onProject(items.filter((i) => onShown(i) && !inParkingLot(i))).map((item) => ({ item, b: boundsOf(item, items) })), [items, onShown]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // the groups of the canvas shown: a group holds the cards of its own canvas only
  const groups = useMemo(() => snapshot.groups.filter((g) => !canvasId || (g.canvas ?? canvases[0]?.id) === canvasId), [snapshot.groups, canvasId, canvases]);
  const territories = useTerritories(placed, groups);
  const kidsOf = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) if (i.parent) m.set(i.parent, [...(m.get(i.parent) ?? []), i]);
    return m;
  }, [items]);
  const repliesIn = useMemo(() => unreadPerPlan(snapshot.talk), [snapshot.talk]);
  // ideas with a prototype on the project, which stay out of the archive until it ends
  const prototyped = useMemo(() => new Set(items.flatMap((i) => (i.idea?.prototypeOf ? [i.idea.prototypeOf] : []))), [items]);
  const [noteHidden, hideNote] = useHiddenEmptyNotes(snapshot.project.id);
  // where notes on plan directories were moved here, by repository, until the server echoes it back
  const [notesMoved, setNotesMoved] = useState<Record<string, Pos>>({});
  useEffect(() => {
    const at = new Map(snapshot.planDirs?.map((d) => [d.repo, d.at]));
    setNotesMoved((m) => {
      const keep = Object.entries(m).filter(([repo, p]) => dragRef.current?.note === repo || at.get(repo)?.x !== p.x || at.get(repo)?.y !== p.y);
      return keep.length === Object.keys(m).length ? m : Object.fromEntries(keep);
    });
  }, [snapshot]);
  // a fresh array only when what is shown changes: the camera keeps the notes in sight
  const planDirs = useMemo(() => {
    // they stand beside the plans found in the repositories, which are on `main`
    if (shownCanvas && shownCanvas.name !== MAIN_CANVAS) return undefined;
    const shown = snapshot.planDirs?.filter((d) => !noteHidden(d)).map((d) => (notesMoved[d.repo] ? { ...d, at: notesMoved[d.repo] } : d));
    return shown?.length ? shown : undefined;
  }, [snapshot.planDirs, noteHidden, notesMoved, shownCanvas?.name]);
  const notes = useMemo(() => (planDirs ? planDirBoxes(planDirs, placed) : []), [planDirs, placed]);
  const all: Bounds = useMemo(() => unionBounds([...placed.map((p) => p.b), ...notes]) ?? { x: 0, y: 0, w: 1000, h: 600 }, [placed, notes]);
  // what the view keeps in sight: the whole area the minimap panel shows, so anywhere on it can be scrolled to; an empty project has no limit
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

  // ---------------------------------------------------------------- camera
  const [cam, setCam, camRef] = useLive<Cam>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(camKey(snapshot.project.id, canvases.find((c) => c.id === canvasId))) ?? 'null');
      // saved as it would be without a sheet, which none is before the page opens one
      if (saved && [saved.x, saved.y, saved.s].every(Number.isFinite)) return keepInView(saved, content, { left: 0, top: TOP, right: innerWidth, bottom: innerHeight - BOTTOM });
    } catch {}
    return centreOn(all, 1);
  });
  // the panels docked at the window's edges that the camera is laid out for: a sheet that opens,
  // closes or is dragged wider moves the view by half the difference, so its middle stays the middle
  const camSide = useRef<Sides>(NO_SIDES);
  /** Flies to `to`, laid out for the sheets as they are now. */
  const fly = (to: Cam, ms?: number) => {
    camSide.current = sideNow();
    return flyTo(camRef.current, to, setCam, ms);
  };
  const flyOrJump = async (to: Cam, ms: number, jump: boolean) => (jump ? ((camSide.current = sideNow()), setCam(to)) : fly(to, ms));
  /** The view `f` was opened from, beside the sheets as they are now. */
  const back = (f: Focus) => besideSheet(f.prevCam, f.prevSide, sideNow());
  useEffect(() => {
    document.documentElement.style.setProperty('--s', String(cam.s));
    if (focusRef.current) return;
    const h = setTimeout(() => {
      try {
        localStorage.setItem(camCanvas.current, JSON.stringify(besideSheet(cam, camSide.current, NO_SIDES)));
      } catch {}
    }, 300);
    return () => clearTimeout(h);
  }, [cam, snapshot.project.id]);
  // the storage key of the canvas the camera shows; another canvas brings back the view kept for it, or one on all of it
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

  // ---------------------------------------------------------------- focus
  const [focus, setFocus, focusRef] = useLive<Focus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dim, setDim] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sheetOn, setSheetOn, sheetOnRef] = useLive(false);
  // the open plan's plan doc, read in the widened sheet
  const [reading, setReading, readingRef] = useLive<{ mark?: string } | null>(null);
  // how wide the sheets are, as the owner dragged them; in effect clamped to the window
  const [widths, setWidths] = useState<SheetWidths>(() => loadWidths(localStorage));
  const sheetW = widthsIn(widths, innerWidth);
  const sheetWRef = useRef(sheetW);
  sheetWRef.current = sheetW;
  const [kOn, setKOn, kOnRef] = useLive(false);
  // the inbox, a docked sheet like Seismic's: only one of them is open; it stays open across projects
  const [inboxOn, setInboxOn, inboxOnRef] = useLive(() => inboxKept(sessionStorage));
  useEffect(() => keepInbox(sessionStorage, inboxOn), [inboxOn]);
  // what of the inbox the owner has read (src/ui/inboxRead.ts)
  const inboxRead = useInboxRead();
  // the project's settings, a docked sheet like the inbox, from the gear in the bar (projectSettings.tsx)
  const [csOn, setCsOn, csOnRef] = useLive(false);
  // the agents, a docked sheet like the inbox, from the robot in the bar: the queue and the cards at work (agents.tsx)
  const [agentsOn, setAgentsOn, agentsOnRef] = useLive(false);
  // Seismic's sheet takes the inbox's place however it opens (its button, `?talk`, a reload), and the settings' and the agents'
  useEffect(() => {
    if (kOn) setInboxOn(false);
    if (kOn) setCsOn(false);
    if (kOn) setAgentsOn(false);
  }, [kOn]);
  // the inbox, the project's settings and the agents take each other's place
  useEffect(() => {
    if (inboxOn) setCsOn(false);
    if (inboxOn) setAgentsOn(false);
  }, [inboxOn]);
  useEffect(() => {
    if (csOn) setAgentsOn(false);
  }, [csOn]);
  useEffect(() => {
    if (agentsOn) setInboxOn(false);
    if (agentsOn) setCsOn(false);
  }, [agentsOn]);
  const [aOn, setAOn, aOnRef] = useLive(false);
  const [cOn, setCOn, cOnRef] = useLive(false);
  // the navigation pinned as a sidebar on the left (src/ui/nav.tsx)
  const [pinned, setPinned, pinnedRef] = useLive(loadPinned);
  const pin = (on: boolean) => {
    setPinned(on);
    savePinned(on);
  };
  /**
   * What the panels docked at the window's edges take of it, as just set: the sheet on the right and
   * the pinned navigation on the left; the project is what remains between them. A narrow window lays
   * the sheet over the project instead (styles.css), and the navigation stays under its button, as it
   * does where it would leave the project too little room beside the sheet: the two never stack.
   */
  const sideNow = (): Sides => {
    const narrow = matchMedia(NARROW).matches;
    const right = narrow || !(kOnRef.current || inboxOnRef.current || csOnRef.current || agentsOnRef.current || sheetOnRef.current) ? 0 : sheetOnRef.current && readingRef.current ? sheetWRef.current.read : sheetWRef.current.sheet;
    return { left: !narrow && pinnedRef.current && innerWidth - NAV_W - right >= NAV_PROJECT_MIN ? NAV_W : 0, right };
  };
  /** Opens Seismic's sheet or closes it; an open plan closes. */
  const toggleKoordinator = () => {
    setKOn(!kOn);
    if (!kOn) setInboxOn(false);
    if (!kOn) setCsOn(false);
    if (!kOn && focusRef.current?.type === 'plan') closePlan(false);
  };
  /** The sheet as the owner opens it to talk (its button, `C`): the field under the conversation takes the cursor. */
  const talkKoordinator = () => {
    toggleKoordinator();
    if (!kOn) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#ksheet .tell textarea')?.focus({ preventScroll: true }));
  };
  const toggleArchive = () => setAOn(!aOnRef.current);
  // the configuration is a dialog over the page: what is open behind it stays as it was
  const toggleConfig = () => (setPrefsOn(false), setCOn(!cOnRef.current));
  // asking Seismic about the configuration: its conversation in place of the dialog, ready to type into
  const talkFromConfig = () => {
    setCOn(false);
    if (!kOn) talkKoordinator();
  };
  const [helpOn, setHelpOn] = useState(false);
  const [cardSearchOn, setCardSearchOn] = useState(false);
  // the app-wide preferences, a dialog over the page as the configuration is, opened from the logo's menu
  const [prefsOn, setPrefsOn] = useState(false);
  const openPrefs = () => {
    setCOn(false);
    setPrefsOn(true);
  };
  // "Connect a phone", from the section "Other devices" of the configuration
  const [phoneOn, setPhoneOn] = useState(false);
  // the performance dashboard, over the page as the configuration is; opened from the logo's menu,
  // the feedback setting or a rated card, and open at once coming back from the feedback log (`?performance`), with its filters
  const [perfAtStart] = useState(() => (new URLSearchParams(location.search).has('performance') ? readLogQuery(location.search).filter : undefined));
  const [perfOn, setPerfOn] = useState(!!perfAtStart);
  const openPerformance = useCallback(() => {
    setCOn(false);
    setPrefsOn(false);
    setPerfOn(true);
  }, []);
  const wishOn = useWish().open;
  // the bar's `?` button stays until the owner opened the legend with the key; the legend's foot says so
  const [helpKnown, setHelpKnown] = useState(() => known(HELP_KEY_KNOWN));
  const [helpNote, setHelpNote] = useState<'button' | 'gone'>();
  // the bar's button for a new task stays until the owner created one by double-click; it only says how
  const [dblKnown, setDblKnown] = useState(() => known(DOUBLE_CLICK_KNOWN));
  const [newHintOn, setNewHintOn] = useState(false);
  const [setupOn, setSetupOn] = useState(false);
  // what is wrong in the configuration as saved, marked on its button; read when the page loads,
  // after a save in the dialog, when a repository's settings change on its default branch, which
  // the project counts in its repositories (`configRev`), and when a project or repository does not
  // start, which the projects count (theirs, and which of them run)
  const [configProblems, setConfigProblems] = useState(0);
  const configRevs = [...snapshot.project.repos.map((r) => `${r.id}:${r.configRev ?? 0}`), ...projects.map((c) => `${c.id}:${c.configRev ?? 0}`), `${snapshot.project.configRev ?? 0}`].join(' ');
  useEffect(() => void api.configCheck().then((c) => setConfigProblems(c.problems.length), console.error), [configRevs]);
  useEffect(() => void api.shownProjectSettings().then((v) => setRightClick(v.settings.rightClick), () => {}), [snapshot.project.id, csOn, cOn, configRevs]);
  // the archive, read while its list is open; archived cards unfold from their row there
  const [archived, setArchived] = useState<Item[]>([]);
  const archivedRef = useRef(archived);
  archivedRef.current = archived;
  /** The card `id`, on the project or else in the archive. */
  const itemOrArchived = (id: string) => byId(id) ?? items.flatMap((i) => i.plan?.manualArchived ?? []).find((i) => i.id === id) ?? archivedRef.current.find((i) => i.id === id);
  const archiveEls = useRef(new Map<string, HTMLElement>()).current;
  // rows of the plan sheet, where its archived workstreams and its idea unfold from
  const sheetEls = useRef(new Map<string, HTMLElement>()).current;
  /** The element a card unfolds from and folds back to: on the project, or a row in the sheet it was opened from. */
  const fromEl = (id: string, inPlan: boolean) =>
    els.get(id) ?? (inPlan ? (sheetEls.get(id) ?? archiveEls.get(id)) : (archiveEls.get(id) ?? sheetEls.get(id)));
  // an archived card opened from a plan's sheet, which the archive list may not hold
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
  const innerRef = useRef<HTMLDivElement>(null);
  // the panel follows its content from the unfold until it starts to fold
  const unfolded = useRef(false);
  const fitPanel = (i: Item) => {
    const panel = panelRef.current;
    const inner = innerRef.current;
    if (panel && inner) Object.assign(panel.style, panelRect(i, inner, sideNow()));
  };

  // edits of the open card, saved shortly after typing stops
  const edit = useRef<{ id: string; patch: CardPatch; timer?: ReturnType<typeof setTimeout> } | null>(null);
  /** Saves what was typed into the open card; actions on it wait for this. */
  const flushEdit = (): Promise<void> => {
    const e = edit.current;
    if (!e) return Promise.resolve();
    clearTimeout(e.timer);
    edit.current = null;
    return Object.keys(e.patch).length ? api.patch(e.id, e.patch) : Promise.resolve();
  };
  // what the open card holds as typed, which the snapshot may not carry yet
  const openDraft = useRef<Pick<Item, 'kind' | 'title' | 'body' | 'images'>>({ kind: 'task', title: '', body: '' });
  const onEdit = (p: CardPatch) => {
    const id = focusRef.current?.id;
    if (!id) return;
    if (p.title !== undefined) openDraft.current.title = p.title;
    if (p.body !== undefined) openDraft.current.body = p.body;
    if (p.images !== undefined) openDraft.current.images = p.images;
    if (edit.current?.id !== id) flushEdit().catch(console.error);
    const e = (edit.current ??= { id, patch: {} });
    Object.assign(e.patch, p);
    clearTimeout(e.timer);
    e.timer = setTimeout(() => flushEdit().catch(console.error), 400);
  };

  /** Unfolds the card `i`; `quick` without the flight and the unfold, as after a reload. */
  async function open(i: Item, reload = false) {
    // reduced motion opens at once too, but shows the card only at the size its content settles at
    const hold = !reload && reducedMotion();
    const quick = reload || hold;
    const f = focusRef.current;
    if (f?.type === 'card') return;
    // a card on another canvas opens there
    if (i.canvas && i.canvas !== canvasRef.current && !i.archivedAt && !inParkingLot(i)) showCanvas(i.canvas);
    if (i.kind === 'plan') return openPlan(i);
    setFocus({ type: 'card', id: i.id, prevCam: camRef.current, prevSide: camSide.current, plan: f });
    openDraft.current = { kind: i.kind, title: i.title, body: i.body, images: i.images ?? [] };
    setOpened(i.archivedAt ? i : null);
    // bring the card to the middle at a readable scale first, so the unfold starts where the eye is;
    // an archived card is not on the project and unfolds from its row in the archive
    if (!i.archivedAt && !inParkingLot(i)) await flyOrJump(centreOnPoint(bounds(i), Math.max(camRef.current.s, 0.85), sideNow()), FLY_MS, quick);
    const el = fromEl(i.id, !!f);
    const panel = panelRef.current;
    // nothing to unfold from: the project stays as it was, open for the next card
    if (!el || !panel) return setFocus(f);
    addressOpens(i, f ? itemOrArchived(f.id) : undefined);
    const r = el.getBoundingClientRect();
    flushSync(() => setOpenId(i.id));
    panel.style.setProperty('--c', `var(--${shownState(i)})`);
    panel.className = '';
    panel.style.setProperty('--unfold', `${quick ? 0 : UNFOLD_MS}ms`);
    Object.assign(panel.style, rect(r), { display: 'block', visibility: hold ? 'hidden' : '' });
    panel.getBoundingClientRect();
    panel.classList.add('anim');
    fitPanel(i);
    unfolded.current = true;
    // laid out while hidden, so it measures what loads; it grows in view only after the cap
    const content = innerRef.current?.firstElementChild;
    if (hold && content) {
      await sizeSettled(content, SETTLE_QUIET_MS, SETTLE_CAP_MS);
      if (!unfolded.current || focusRef.current?.id !== i.id) return;
      panel.style.visibility = '';
    }
    setDim(true);
    if (!quick) await sleep(UNFOLD_MS);
    panel.classList.add('ready');
    // a card of the owner's without a title is written in its text first: Seismic names it from that
    const title = panel.querySelector<HTMLTextAreaElement>('textarea.p-title');
    const body = panel.querySelector<HTMLElement>('.p-body');
    if (title && !title.value) (body ?? title).focus();
    // the cursor at the end of the text
    if (body && body === document.activeElement) {
      getSelection()?.selectAllChildren(body);
      getSelection()?.collapseToEnd();
    }
  }

  // a card that starts or finishes work while open changes its width and colour: resize in place
  const openItem = openId
    ? (itemOrArchived(openId) ?? (opened?.id === openId ? opened : undefined))
    : undefined;
  const openState = openItem && `${shownState(openItem)}:${openItem.need ?? ''}:${split(openItem)}`;
  useEffect(() => {
    const panel = panelRef.current;
    const i = openItem;
    if (!panel || !i || !unfolded.current) return;
    panel.style.setProperty('--c', `var(--${shownState(i)})`);
    fitPanel(i);
  }, [openState]);
  // content that grows or shrinks (a log loading, a question arriving, a resized text box) resizes it too
  useEffect(() => {
    const content = innerRef.current?.firstElementChild;
    if (!openId || !content) return;
    // in the next frame: a split that fills the panel takes back what the rest grew by, which would
    // change the content again while the observer reports
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
  // and so does the window: a split filling the panel takes the height it has
  useEffect(() => {
    const i = openId && itemOrArchived(openId);
    if (i && unfolded.current) fitPanel(i);
  }, [tick]);

  // the open card went away on the server (cut into packages, deleted elsewhere): fold the panel
  useEffect(() => {
    if (openId && !openItem && focusRef.current?.type === 'card') closeCard({ keepUntitled: true });
  }, [openId, openItem]);

  function onDone(d: ActDone, p?: Pending) {
    if (!d.close) return;
    closeCard({ keepUntitled: true });
    if (!p || !d.pending) {
      if (d.rate) ratePrompt.ask(d.rate);
      return showAck(d.ack, d.undo);
    }
    // the card says it is under way until the snapshot moves it on; a refusal puts it back as it was
    const what = d.pending;
    setUnderway((u) => ({ ...u, [p.card]: what }));
    showWait(`${what.charAt(0).toUpperCase()}${what.slice(1)}`);
    p.answered.then(
      () => {
        if (d.rate) ratePrompt.ask(d.rate);
        showAck(d.ack, d.undo);
      },
      (e) => {
        if (!(e instanceof ApiError)) console.error(e);
        setUnderway(({ [p.card]: _, ...rest }) => rest);
        showAck(t.cardError(p.title, failText(e)));
      },
    );
  }

  /** Folds the open card; `onward` where another opens in its place next, which takes over its address. */
  async function closeCard({ keepUntitled = false, onward = false } = {}) {
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
    panel.className = '';
    beingWritten.delete(f.id);
    setOpenId(null);
    setFocus(f.plan);
    // a new card left empty was not wanted; one with a task but no title, Seismic names
    const draft = openDraft.current;
    if (i?.source === 'manual' && !draft.title.trim()) {
      if (nameless(draft)) saved.then(() => api.act(i.id, { action: 'name' })).catch(console.error);
      else if (!keepUntitled) api.remove(i.id).catch(console.error);
    }
    // the view stays where the card was brought to, so it can be seen among the rest
    // the card may have gone (archived, deleted) and taken the last content in view with it
    recover();
  }

  /**
   * Opens a card the server made just now (a thread moved onto a Question card), which the project
   * may not show yet; a card open now folds first.
   */
  async function openFresh(i: Item) {
    const f = focusRef.current;
    if (f?.type === 'card') {
      if (f.id === i.id) return;
      await closeCard({ keepUntitled: true, onward: true });
    }
    flushSync(() => {
      if (!snapshotRef.current.items.some((x) => x.id === i.id)) setPending((p) => [...p, i]);
    });
    await open(i);
  }

  async function openPlan(p: Item, quick = false) {
    // an archived plan is not on the project: its sheet takes the archive list's place
    await planSheet(p, null, quick, !p.archivedAt);
  }

  /** Reads the plan's plan doc in the sheet, at the workstream `mark`; `null` goes back to the workstreams. */
  async function readPlan(p: Item, r: { mark?: string } | null, quick = false) {
    if (focusRef.current?.type === 'card') await closeCard();
    // the plan stays in view beside the wider sheet
    await planSheet(p, r, quick, true);
  }

  /** Shows the plan in the sheet, its workstreams or (`r`) its plan doc, and with `inView` flies to it. */
  async function planSheet(p: Item, r: { mark?: string } | null, quick: boolean, inView: boolean) {
    // a plan on another canvas opens there
    if (p.canvas && p.canvas !== canvasRef.current && !p.archivedAt) showCanvas(p.canvas);
    const f = focusRef.current;
    setFocus(f?.type === 'plan' ? { ...f, id: p.id } : { type: 'plan', id: p.id, prevCam: camRef.current, prevSide: camSide.current });
    addressOpens(p, undefined);
    setSheetId(p.id);
    setReading(r);
    setSheetOn(true);
    setKOn(false);
    setInboxOn(false);
    setCsOn(false);
    setAgentsOn(false);
    setAOn(false);
    if (inView) await flyOrJump(camFor(bounds(p), sideNow()), 700, quick);
  }

  /** Closes the open plan; `toArchive`: back to the archive an archived one was opened from. */
  async function closePlan(toArchive = true) {
    const f = focusRef.current;
    if (f?.type !== 'plan') return;
    setFocus(null);
    addressCloses(undefined);
    setSheetOn(false);
    if (toArchive && archivedRef.current.some((i) => i.id === f.id) && !itemsRef.current.some((i) => i.id === f.id)) setAOn(true);
    await fly(back(f), 600);
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
    // nothing for Seismic to name: the card goes
    openDraft.current = { kind: i?.kind ?? 'task', title: '', body: '' };
    await closeCard({ keepUntitled: true });
    if (!i) return;
    await api.remove(i.id);
    if (title) showAck(t.deleted(plain(title)), () => api.restore(i.id));
  }

  /** A new card centred at `world`; `made` runs once it exists, before it opens. */
  async function createAt(world: Pos, made?: (card: Item) => Promise<unknown>) {
    const [w, h] = CARD_SIZE.task;
    const card = await api.create({ title: '', x: Math.round(world.x - w / 2), y: Math.round(world.y - h / 2), ...(canvasRef.current ? { canvas: canvasRef.current } : {}) });
    await made?.(card);
    beingWritten.add(card.id);
    flushSync(() => {
      // the snapshot that carries it may have come first: then it is no longer pending
      if (!snapshotRef.current.items.some((i) => i.id === card.id)) setPending((p) => [...p, card]);
      setPopId(card.id);
    });
    await open(card);
  }
  const createAtCentre = () => createAt(toWorld(camRef.current, midX(sideNow()), innerHeight / 2));

  // ---------------------------------------------------------------- kept across a restart
  // a restart reloads the page: what was open comes back as it was, without the flights
  const keepNow = useRef(() => {});
  keepNow.current = () => {
    flushEdit().catch(console.error);
    const f = focusRef.current;
    const plan = f?.type === 'plan' ? f.id : f?.type === 'card' ? f.plan?.id : undefined;
    const sheet: SideSheet | undefined = kOn ? 'koordinator' : inboxOn ? 'inbox' : csOn ? 'settings' : agentsOn ? 'agents' : aOn ? 'archive' : undefined;
    keep(sessionStorage, snapshot.project.id, {
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
  // Seismic's sheet left open over a draft comes back with the project; left empty or closed, it stays closed
  useEffect(() => {
    const away = () => leaveSheet(sessionStorage, snapshot.project.id, kOnRef.current && drafted(OBEYA_DRAFT));
    addEventListener('pagehide', away);
    return () => removeEventListener('pagehide', away);
  }, []);
  useEffect(() => {
    const k = takeKept(sessionStorage, snapshot.project.id);
    const sheetLeft = takeSheetLeft(sessionStorage, snapshot.project.id);
    // the project's own address, where the page came without one or with another project's; `?talk`
    // (Seismic's answer in another project's navigation) opens Seismic's sheet, once
    const a = readAddress();
    const code = !a.project || projectNamed(projects, a.project)?.id === snapshot.project.id ? a.card : undefined;
    const talk = new URLSearchParams(location.search).has('talk');
    history.replaceState(history.state, '', `${code ? cardPath(snapshot.project.id, code) : projectPath(snapshot.project.id)}${queryWithout(location.search, 'c', 'card', 'talk', ...(perfAtStart ? LOG_KEYS : []))}${location.hash}`);
    // what comes back is what the address names already; a kept card the address left out (a
    // restart of the app's shell, a link to the project) gets its address once it is open
    addressSet.current = true;
    const done = () => {
      addressSet.current = false;
      history.replaceState(history.state, '', pathOf(openNow()));
    };
    if (k) return void reopen(k).catch(console.error).finally(done);
    if (sheetLeft || talk) {
      // beside the sheet at once, as the project comes back
      quickSide.current = Date.now() + 2000;
      setKOn(true);
    }
    (code ? openAddress(code, true) : Promise.resolve()).catch(console.error).finally(done);
  }, []);
  async function reopen(k: Kept) {
    // the sheet that comes back sets the camera beside it at once, as the rest comes back without flights
    quickSide.current = Date.now() + 2000;
    if (k.sheet === 'koordinator') setKOn(true);
    else if (k.sheet === 'inbox') setInboxOn(true);
    else if (k.sheet === 'settings') setCsOn(true);
    else if (k.sheet === 'agents') setAgentsOn(true);
    else if (k.sheet === 'archive') setAOn(true);
    if (k.config) setCOn(true);
    if (k.prefs) setPrefsOn(true);
    await openAgain(k, true);
    restore(k);
  }
  /** Opens the plan `k.plan` (its plan doc with `reading`) and the card `k.card` in it or on the project; an archived one from its row in the archive or the plan's sheet. */
  async function openAgain(k: Pick<Kept, 'card' | 'plan' | 'reading'>, quick: boolean) {
    const find = async (id?: string) => (id ? namedBy(id) : undefined);
    // an archived plan's sheet lists its workstreams from the archive, which this loads
    const p = await find(k.plan);
    // the doc opens at its top, and the kept position puts it back where it was
    if (p) await (k.reading ? readPlan(p, {}, quick) : openPlan(p, quick));
    const i = await find(k.card);
    // an archived card unfolds from its row in the archive or the plan's sheet, once that has loaded
    if (i && (!i.archivedAt || (await soon(() => fromEl(i.id, !!p))))) await open(i, quick);
  }

  // ---------------------------------------------------------------- the address
  // the address names the open card or plan (`/p/<project>/c/<code>`). Opening one is a step in
  // the browser's history, so Back closes it again, as on the phone; one opened in place of another
  // (by a link in it) takes over that one's step. Changes take effect one after the other: a step
  // back is done once the browser says so.
  const addressChain = useRef(Promise.resolve());
  const address = (change: () => void | Promise<void>) => void (addressChain.current = addressChain.current.then(change).catch(console.error));
  /** The step back this page asked the browser for, until it is done. */
  const stepBack = useRef<(() => void) | null>(null);
  /** While the page opens what the address names (as it loads, on Back or Forward): the address is set already. */
  const addressSet = useRef(false);
  /** The card or plan open now. */
  const openNow = () => {
    const f = focusRef.current;
    return f ? itemOrArchived(f.id) : undefined;
  };
  // the hash names the canvas shown, which a card opened there is on too
  const pathOf = (i: Item | undefined) => `${i ? cardPath(snapshot.project.id, i) : projectPath(snapshot.project.id)}${location.search}${location.hash}`;
  /** `i` opens over `under` (the plan it is opened from, else the project). */
  function addressOpens(i: Item, under: Item | undefined) {
    if (addressSet.current) return;
    address(() => {
      const at = readAddress().card;
      if (at && named([i], at)) return;
      if (!at || (under && named([under], at))) history.pushState({ step: true }, '', pathOf(i));
      else history.replaceState(history.state, '', pathOf(i));
    });
  }
  /** What is open closes down to `under` (the plan still open, else the project). */
  function addressCloses(under: Item | undefined) {
    if (addressSet.current) return;
    address(() => {
      if (!(history.state as { step?: true } | null)?.step) return history.replaceState(history.state, '', pathOf(under));
      return new Promise<void>((done) => {
        stepBack.current = () => {
          // the step before may name what is no longer open (a card opened over its plan, then reloaded without it)
          const at = readAddress().card;
          if (at && !(under && named([under], at))) history.replaceState(history.state, '', pathOf(under));
          done();
        };
        history.back();
      });
    });
  }
  /** The card or plan an address (or an id) names, on the project or in the archive, which it loads where it has to. */
  async function namedBy(code: string) {
    const here = named(itemsRef.current, code) ?? named(archivedRef.current, code);
    if (here) return here;
    const gone = await api.archived().catch(() => []);
    archivedRef.current = gone;
    setArchived(gone);
    return named(gone, code);
  }
  /** Opens what the address names; a code no card has leaves the project, at its address. */
  async function openAddress(code: string, quick: boolean) {
    const i = await namedBy(code);
    // by its short code, where it was named by its id
    history.replaceState(history.state, '', pathOf(i));
    if (!i) return;
    if (i.kind === 'plan') return openAgain({ plan: i.id }, quick);
    // an archived workstream unfolds from its plan's sheet, any other archived card from the archive's list
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
      if (f.id === i.id) return;
      await closeCard({ keepUntitled: true, onward: true });
    }
    const plan = i.archivedAt ? i.parent : undefined;
    if (i.archivedAt && !plan) setAOn(true);
    await openAgain({ card: i.id, plan }, false);
  }
  /** Back or Forward: what the address no longer names closes, what it names opens. */
  async function followAddress() {
    const code = readAddress().card;
    const i = code ? await namedBy(code) : undefined;
    addressSet.current = true;
    try {
      const f = focusRef.current;
      if (f?.type === 'card' && f.id !== i?.id) await closeCard({ keepUntitled: true });
      const p = focusRef.current;
      if (p?.type === 'plan' && p.id !== i?.id && i?.parent !== p.id) await closePlan(false);
      // a code no card has any longer: openAddress leaves the project at its address
      if (code && (!i || focusRef.current?.id !== i.id)) await openAddress(code, false);
    } finally {
      addressSet.current = false;
    }
  }
  const follow = useRef(followAddress);
  follow.current = followAddress;
  useEffect(() => {
    const pop = () => {
      const done = stepBack.current;
      stepBack.current = null;
      if (done) done();
      else address(() => follow.current());
    };
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);

  // ---------------------------------------------------------------- acknowledgement with undo
  const toasts = useToasts();
  const { showAck, showWait, fail } = useAck(toasts.store);
  const warnings = useWarnings(toasts.store, (id) => {
    const i = itemsRef.current.find((x) => x.id === id);
    if (i) void open(i);
  });
  const ratePrompt = useRatePrompt(items);

  /** The play button on a card: starts it, or one queued behind others despite the likely conflict. */
  const startCard = useCallback(async (i: Item) => {
    try {
      const waiting = i.queue ? manualPrerequisites(i, items) : [];
      if (waiting.length && !window.confirm(t.queue.confirmManualStart(waiting.map((card) => plain(card.title)).join(', ')))) return;
      await api.act(i.id, { action: i.queue ? 'force' : 'start' });
      if (i.queue) showAck(forcedText(i.queue));
    } catch (e) {
      fail(e);
    }
  }, [items]);

  /** The archive button on a finished card or a parked or dropped idea: takes it off the project, with a moment to undo. */
  const archiveCard = useCallback(async (i: Item) => {
    try {
      await api.archive(i.id);
      ratePrompt.ask(i.id);
      showAck(t.archive.archived(plain(i.title)), () => api.unarchive(i.id));
    } catch (e) {
      fail(e);
    }
  }, []);

  /**
   * The plan's button, on its card and in its sheet: all planned workstreams go to the
   * Koordinator together, which waits a few seconds before it plans them, so the start can be taken back.
   */
  const startAll = useCallback(async (p: Item, n: number) => {
    try {
      await api.act(p.id, { action: 'start' });
      showAck(
        t.plan.startedAll(n),
        async () => {
          try {
            await api.act(p.id, { action: 'dequeue' });
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

  /**
   * "Give to the waiting card" in the Workstations list: the card's clone goes to the card waiting longest once the
   * undo window is through; "Undo" (here or in its row) takes that back meanwhile.
   */
  const keepWorkstation = useCallback(async (i: Item) => {
    try {
      await api.act(i.id, { action: 'keepWorkstation' });
      showAck(t.workstations.keptBack(plain(i.title)));
    } catch (e) {
      showAck(e instanceof ApiError && e.code === 'notEvictable' ? t.voice.tooLate : failText(e));
    }
  }, []);
  const takeWorkstation = useCallback(async (i: Item) => {
    try {
      await api.act(i.id, { action: 'takeWorkstation' });
      showAck(t.workstations.taken(plain(i.title)), () => keepWorkstation(i), EVICT_HOLD_MS);
    } catch (e) {
      fail(e);
    }
  }, []);

  /**
   * The plan's "Arrange", on its card and in its sheet: its workstreams in columns by what builds
   * on what, once Seismic has read that from the plan doc. It takes effect at once; "Undo" puts
   * the cards (and the plan, which may have made room for itself) back where they stood.
   */
  const arrange = useCallback(async (p: Item) => {
    const before = [p, ...itemsRef.current.filter((i) => i.parent === p.id)].map(({ id, x, y }) => ({ id, x, y }));
    try {
      await api.act(p.id, { action: 'arrange' });
      showAck(t.plan.arranged, async () => {
        try {
          await Promise.all(before.map(({ id, x, y }) => api.patch(id, { x, y })));
          showAck(t.plan.arrangeUndone);
        } catch (e) {
          fail(e);
        }
      });
    } catch (e) {
      fail(e);
    }
  }, []);

  /** The fold in a plan's head: collapsed, only its head and a mark for each workstream stay on the project. */
  const collapse = useCallback(async (p: Item, collapsed: boolean) => {
    setFolded((f) => ({ ...f, [p.id]: collapsed }));
    try {
      await api.patch(p.id, { collapsed });
    } catch (e) {
      setFolded(({ [p.id]: _, ...rest }) => rest);
      fail(e);
    }
  }, []);
  // a stable handle on `open` for the memoised plan views
  const openRef = useRef(open);
  openRef.current = open;
  const openCard = useCallback((i: Item) => void openRef.current(i).catch(console.error), []);
  const notifyAsk = useDesktopNotifications(snapshot, openCard);

  /** "Als Plan aufbereiten" on the note on a plan directory: a card whose agent prepares the doc, started at once. */
  const preparePlanDoc = useCallback(async (dir: PlanDir, file: string) => {
    try {
      const card = await api.preparePlanDoc(snapshot.project.id, dir.repo, file);
      showAck(t.planDir.started(plain(card.title)));
    } catch (e) {
      fail(e);
    }
  }, []);

  // ---------------------------------------------------------------- voice
  const where = (): Where => {
    const f = focusRef.current;
    return f?.type === 'card' ? { card: f.id } : f?.type === 'plan' ? { plan: f.id } : null;
  };
  // where the pointer is on the page, null once it left the window
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
  // a command that makes a card: when it appears out of view, the camera goes there
  const newCardWatch = useRef<{ known: Set<string>; until: number } | null>(null);
  function onHeard(h: Heard) {
    // said to the open card's agent: the card shows it
    if (h.quiet) return;
    // the owner asked to tell Seismic's makers something: the draft for them opens
    if (h.wish) openWish(h.wish);
    if (h.token && !focusRef.current) newCardWatch.current = { known: new Set(itemsRef.current.map((i) => i.id)), until: Date.now() + 20_000 };
  }
  // the reply stands in Seismic's sheet, or the answer in the plan's sheet, open in front of the owner: no line above the microphone
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
  const { tellAbout, tellTyped } = tellers(byId, told, fail, placeNow);
  /** "Go to card" on a confirmation's line: the card it made opens (in place of one open), one made on another project opens there. */
  function goToMade(c: { id: string; project?: string }) {
    if (c.project && c.project !== snapshotRef.current.project.id) return location.assign(cardPath(c.project, c.id));
    newCardWatch.current = null;
    setKOn(false);
    void openNamed(c.id).catch(console.error);
  }
  // a card Seismic asked to open before it was on the project
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
    // a new idea opens, so the owner sees the discussion begin
    if (made.state === 'idea') {
      setKOn(false);
      open(made);
    } else if (!shows(camRef.current, viewNow(), boundsOf(made, itemsRef.current))) fly(centreOnPoint(boundsOf(made, itemsRef.current), Math.max(camRef.current.s, 0.8), sideNow()), 700);
  }, [snapshot]);
  // what Seismic tells the owner without a command to answer: an answer looked up, what a request a
  // card's agent passed on came to (with "Undo" while its actions wait)
  useEffect(
    () =>
      onNotice((n) => {
        // the open card moved to another project (built in a new repository there): the page follows it
        // the cards a confirmed command made: its line offers to go to them
        if (n.made && n.token) return told.made(n.token, n.made);
        if (n.level === 'warning') return warnings.show(noticeLine(n.text), n.cardId);
        const f = focusRef.current;
        if (n.movedTo && n.cardId && f?.type === 'card' && f.id === n.cardId) return location.assign(cardPath(n.movedTo, n.cardId));
        const i = itemsRef.current.find((x) => x.id === n.cardId);
        if (n.wish) openWish(n.wish);
        // the card a review of its PR asked for, unless the owner has another one open; one just made, once it is on the project
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
  const draftFor = (target: Where) => (target && 'card' in target ? cardDraft(target.card) : !target && kOnRef.current ? OBEYA_DRAFT : null);
  /** The draft a recording for `target` goes out with: its field's, or without one on the page the screenshots beside the mic. */
  const fieldFor = (target: Where) => {
    const key = draftFor(target);
    return key && fieldOn(key) ? key : MIC_DRAFT;
  };
  const ptt = usePushToTalk(where, fieldFor, tellAbout, (h) => showAck(h.confirm), placeNow);
  const pttRef = useRef(ptt);
  pttRef.current = ptt;
  // a text field's microphone, and Space held in it
  /** The open card's demo video while the owner holds Space or the microphone: whether it played, and since when. */
  const pressing = useRef<{ video: HTMLVideoElement | null; playing: boolean; at: number; space: boolean; dictating: boolean } | null>(null);
  /** Space or the microphone held: the demo video pauses, so its narration stays out of the recording. */
  const press = (space: boolean) => {
    const f = focusRef.current;
    const video = f?.type === 'card' ? (videoOf(f.id) ?? panelRef.current?.querySelector('video') ?? null) : null;
    pressing.current = { video, playing: !!video && !video.paused, at: performance.now(), space, dictating: !!focusedDraft() };
    video?.pause();
    // a tap on Space plays or pauses the video: with one open, the microphone shows it listens only once Space stays down
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
    // a screenshot pasted (⌘V) anywhere but in a text field goes to the field in view, or beside the mic
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
  // a card a command makes goes into what is in view, reported once the view rests
  useEffect(() => {
    const h = setTimeout(() => reportFocus(placeNow(false)), 300);
    return () => clearTimeout(h);
  }, [focus?.type, focus?.id, cam, tick, kOn, sheetOn, sheetW.sheet, canvasId]);

  // ---------------------------------------------------------------- pointer: pan, drag, click
  const viewportRef = useRef<HTMLDivElement>(null);
  // `from`: where the press began; one that went nowhere is a click on the empty project
  const panRef = useRef<{ x: number; y: number; from: Pos } | null>(null);
  // a dragged card follows the world point it was picked up at, also while the view scrolls under it
  // (or the note on a plan directory, by its repository, with where it is now)
  // `with`: the other marked cards, which move by as much; `shift`: a Shift + click marks the card instead of opening it
  type Drag = { id: string; note?: string; to?: Pos; with: { id: string; start: Pos }[]; shift: boolean; x: number; y: number; px: number; py: number; grab: Pos; start: Pos; limit: Bounds; moved: boolean; frame: number; last: number };
  const dragRef = useRef<Drag | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragWith, setDragWith] = useState<string[]>([]);
  // the card the pointer is on, for the waits around it
  const [hoverId, setHoverId] = useState<string | null>(null);
  // fingers on the project (touch.ts): whether the last press was one, and what the element under the first finger was
  const [touchy, setTouchy] = useState(false);
  const touchyRef = useRef(false);
  const touchEl = useRef<Element | null>(null);
  const touchesRef = useRef<Touches | null>(null);
  // on touch, the card that was picked up and let go stands for the pointer resting on it: its dots and waits show
  const [touchFocus, setTouchFocus] = useState<string | null>(null);
  // how the long press works shows on a touch screen until the owner has used it once
  const [holdKnown, setHoldKnown] = useState(() => known(TOUCH_HOLD_KNOWN));
  const coarse = useMemo(() => matchMedia('(pointer: coarse)').matches, []);
  const learnHold = () => {
    if (holdKnown) return;
    know(TOUCH_HOLD_KNOWN);
    setHoldKnown(true);
  };
  const [connection, setConnection] = useState<{ from: string; side: Side; x: number; y: number; target?: string; anchor?: ManualAnchor } | null>(null);
  // the dot under the pointer: the project renders again only when it changes
  const [handle, setHandle] = useState<{ id: string; side: Side } | null>(null);
  const handleRef = useRef(handle);
  const showHandle = (h: { id: string; side: Side } | null) => {
    const was = handleRef.current;
    if (was?.id === h?.id && was?.side === h?.side) return;
    handleRef.current = h;
    setHandle(h);
  };
  const connectable = (item: Item) => item.source !== 'plan' && item.kind !== 'plan';
  // what covers an arrow's trash button: the cards, which lie above the arrows
  // an arrow the owner drew at chosen edges follows its own route between them
  const routeOf = (from: string, to: string, a: Bounds, b: Bounds, head: number) => {
    const anchor = byId(to)?.plan?.manualAnchors?.[from];
    return anchor ? anchoredPath(a, b, anchor, head).path : undefined;
  };
  // on touch the dots show on the card picked up and let go, and on the marked ones
  const touchDots = (id: string) => touchy && !dragId && (touchFocus === id || selection.includes(id));
  const cardBoxes = useMemo(() => placed.flatMap(({ item, b }) => (item.kind === 'plan' ? [] : [b])), [placed]);
  const titleOf = (id: string) => {
    const i = byId(id);
    return clip(i ? plain(i.title) || titleFrom(i.body) || t.titlePlaceholder : '…', 50);
  };
  // what an arrow does shows while the owner draws one, until they have drawn their first
  const [depKnown, setDepKnown] = useState(() => known(DEP_KNOWN));
  // arrows the owner removed that the server may still have: one holding a queued card goes there only
  // once "Undo" has run out (`sent` from then on), so that taking it back never leaves the card started
  const [removing, setRemoving] = useState<{ key: string; sent?: true }[]>([]);
  // those removals while "Undo" runs, each with its timer and what sends it
  const pendingRemovals = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; send: (keepalive?: boolean) => void }>());
  // what the owner removed goes to the server even when the page goes before "Undo" has run out
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
  // Shift + drag on the project draws a lasso, Shift + click on a card takes it in or out: what is marked
  // moves together and goes into a group at once through the colour ring
  const lassoRef = useRef<Pos[] | null>(null);
  const [lasso, setLasso] = useState<Pos[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const marked = selection.filter((id) => placed.some((p) => p.item.id === id));
  // how to mark shows after a card was moved alone, until the owner has marked cards; how to move them beside them, until they have
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
    // the next click anywhere, a drag of the project or a scroll of it lets the hint go at once
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
  // what a right click on a card opens, as the project's settings say (read again when the settings sheet or Configuration closes)
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
    // the territory grows from the pointer, or from the one card it is for
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
      api.dependency(from, to.id, true).then(
        () => showAck(t.deps.removed, () => api.dependency(from, to.id).catch(fail)),
        fail,
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
  // a removal the server has done is shown by the snapshot from then on
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
    // a long press of a finger picks up a card instead (touch.ts)
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
  // the panels docked at the window's edges; the project, its edge indicators, the bar and the microphone keep between them
  const side = sideNow();
  const quickSide = useRef(0);
  useEffect(() => {
    const from = camSide.current;
    if (side.left === from.left && side.right === from.right) return;
    camSide.current = side;
    // the open card's view goes back to where it was opened from, beside whatever sheet is open then
    if (focusRef.current?.type === 'card') return;
    const to = kept(besideSheet(camRef.current, from, side));
    if (resizing || Date.now() < quickSide.current) {
      stopFlight();
      setCam(to);
    } else fly(to, 450);
  }, [side.left, side.right]);

  // the grip at the open sheet's left edge widens or narrows it; reading a plan doc has its own width
  const gripOn = kOn || inboxOn || csOn || agentsOn || sheetOn;
  const gripKind = !!reading && sheetOn ? 'read' : 'sheet';
  const gripRef = useRef<{ x: number; w: number; kind: 'sheet' | 'read' } | null>(null);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) saveWidths(localStorage, widths);
  }, [widths, resizing]);
  function onGripDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gripRef.current = { x: e.clientX, w: sheetW[gripKind], kind: gripKind };
    setResizing(true);
  }
  function onGripMove(e: React.PointerEvent) {
    const g = gripRef.current;
    if (!g) return;
    const w = clampWidth(g.w + g.x - e.clientX, innerWidth, g.kind);
    setWidths((ws) => ({ ...ws, [g.kind]: w }));
  }
  function onGripUp() {
    gripRef.current = null;
    setResizing(false);
  }
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
      // a finger did not hover on its way: the arrow aims at where it lands
      const conn = touch ? aimed(connection, e.clientX, e.clientY) : connection;
      const { from, side } = conn;
      const start = placed.find((p) => p.item.id === from)?.b;
      // a click on the empty project makes the card that is to wait there, and connects it
      if (!conn.target && start && !(e.target as Element).closest('.item, .plan-dir, button')) {
        // the arrow's head stays where the owner clicked: the card lies behind it, its edge facing the arrow
        const startAt = handleAt(start, side), at = toWorld(camRef.current, e.clientX, e.clientY);
        const [w, h] = CARD_SIZE.task, dx = at.x - startAt.x, dy = at.y - startAt.y;
        const across = Math.abs(dx) * h >= Math.abs(dy) * w;
        const toSide: Side = across ? (dx < 0 ? 'right' : 'left') : (dy < 0 ? 'bottom' : 'top');
        const centre = across ? { x: at.x + Math.sign(dx || 1) * w / 2, y: at.y } : { x: at.x, y: at.y + Math.sign(dy) * h / 2 };
        createAt(centre, (card) => api.dependency(from, card.id, false, false, { fromSide: side, toSide, offset: 0.5 }).catch((err) => showAck(failText(err))))
          .catch(console.error);
        if (!depKnown) {
          know(DEP_KNOWN);
          setDepKnown(true);
        }
      } else if (conn.target) {
        // the arrow drawn again while its removal waits for "Undo" to run out: it simply stays
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
      // no emulated mouse press follows the finger: it would take the focus from a card a double-tap just opened
      e.preventDefault();
      if (!touchesRef.current!.busy) touchEl.current = e.target as Element;
      touchesRef.current!.down(e.pointerId, { x: e.clientX, y: e.clientY }, touchTarget(e.target as Element));
      viewportRef.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (grab(e.target as Element, e.clientX, e.clientY, e.shiftKey)) {
      // Shift + press would otherwise extend the page's text selection up to the pointer
      if (e.shiftKey) e.preventDefault();
    } else if (e.shiftKey) {
      // Shift + press would otherwise extend the page's text selection up to the pointer
      e.preventDefault();
      lassoRef.current = [{ x: e.clientX, y: e.clientY }];
      setLasso(lassoRef.current);
    } else {
      panRef.current = { x: e.clientX, y: e.clientY, from: { x: e.clientX, y: e.clientY } };
      setPanning(true);
    }
    viewportRef.current!.setPointerCapture(e.pointerId);
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
      // it moves by its top left as it stands now: one above the plans stands on its bottom
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
      // a marked card takes the other marked ones along
      const along = movesWith(marked, i.id).flatMap((id) => {
        const x = byId(id);
        return x ? [{ id, start: { x: x.x, y: x.y } }] : [];
      });
      const moving = new Set([i.id, ...along.map((a) => a.id)]);
      // the view scrolls as far as the rest of the project reaches, plus room to drop the cards beside it
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
    // workstreams stay inside their plan
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
    // the arrow ends where the pointer is nearest on the target's edges, and keeps that place
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
    // the dots stay hidden while something is dragged, lassoed or panned, and while a card is open
    const busy = lassoRef.current || dragRef.current || panRef.current || focusRef.current?.type === 'card';
    if (busy) showHandle(null);
    else {
      const c = camRef.current;
      const near = placed.flatMap(({ item, b }) => (connectable(item) ? [{ id: item.id, b }] : []));
      // near its dot, or anywhere close along its edge
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
    // the view follows the pointer step by step, so after a stop at the content's edge it turns back at once
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
    // a click on the empty project lets go of what is marked
    if (p && Math.hypot(e.clientX - p.from.x, e.clientY - p.from.y) < 5) setSelection([]);
  }

  function onPointerCancel(e: React.PointerEvent) {
    if (e.pointerType === 'touch') touchesRef.current!.cancel(e.pointerId, { x: e.clientX, y: e.clientY });
    else onPointerUp(e);
  }

  /** What a finished lasso (screen points) caught is marked; one that went nowhere is a click. */
  function endLasso(l: Pos[]) {
    const c = camRef.current;
    // a Shift + click on a plan beside its workstreams marks the plan
    if (l.every((p) => Math.hypot(p.x - l[0]!.x, p.y - l[0]!.y) < 5)) {
      const el = document.elementFromPoint(l[0]!.x, l[0]!.y)?.closest<HTMLElement>('.item');
      const i = el && byId(el.dataset.id!);
      if (i) setSelection((sel) => toggle(sel, markable(i)));
      return;
    }
    // what the lasso caught: each card whose middle lies inside, a workstream as its plan
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
    // a card held on touch and let go where it was stays unsaved
    if (d.moved && (i.x !== d.start.x || i.y !== d.start.y)) {
      for (const x of [i, ...d.with.flatMap((w) => byId(w.id) ?? [])])
        api.patch(x.id, { x: x.x, y: x.y }).catch((err) => {
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
    // fingers double-tap through touch.ts
    if (!touchyRef.current) newCardAt(e.clientX, e.clientY);
  }

  /** A double-click or double-tap at (x, y) on the empty project makes a new card there. */
  function newCardAt(x: number, y: number) {
    // the pointer capture retargets the event to the viewport, so look at what is under the pointer
    if (focusRef.current || document.elementFromPoint(x, y)?.closest('.item, .plan-dir')) return;
    createAt(toWorld(camRef.current, x, y));
    if (!dblKnown) {
      know(DOUBLE_CLICK_KNOWN);
      setDblKnown(true);
      setNewHintOn(false);
    }
  }

  // what the fingers do on the project (touch.ts); the host gets this render's closures
  const touchHost: ConstructorParameters<typeof Touches>[0] = {
    pan: (dx, dy) => {
      const c = camRef.current;
      setCam(kept({ ...c, x: c.x + dx, y: c.y + dy }));
    },
    pinch: (from, to) => setCam(kept(pinchCam(camRef.current, from, to))),
    tap: (_, target) => {
      // a tap on the empty project lets go of what is marked, and of the card that showed its dots
      if (!target) {
        setSelection([]);
        setTouchFocus(null);
        return;
      }
      const i = target.startsWith('note:') ? undefined : byId(target);
      if (!i) return;
      // while cards are marked, a tap takes one in or out, as Shift + click does
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
      // the card let go shows its dots for drawing an arrow, and its waits
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

  // ---------------------------------------------------------------- keys
  // an approved card stops needing the owner with the click, before the snapshot says it lands
  const underwayRef = useRef(underway);
  underwayRef.current = underway;
  const yours = (i: Item) => needsYou(i) && !underwayRef.current[i.id];
  // the inbox, what waits on every project: this one's as this page sees it, without what the owner just
  // acted on (on any project: its reply is under way) and without answers in Seismic's sheet while it is open
  const here = waitingIn({ ...snapshot, items, talk: kOn ? [] : snapshot.talk });
  const entries = inboxEntries(projects, { ...waiting, [snapshot.project.id]: here }, (id) => !!underway[id]);
  // only what the owner has not read yet counts
  const attentionCount = waitingCount(entries, undefined, inboxRead.read);
  // the cards waiting in the queue, counted in grey on the agents' button
  const queued = queueOrder(items).length;
  const counts = Object.fromEntries(projects.map((c) => [c.id, waitingCount(entries, c.id, inboxRead.read)]));
  // the open card's entry is read, and stays so while it is open, even as the card waits anew
  const openEntry = openId ? entries.find((e) => e.card?.id === openId && e.project === snapshot.project.id) : undefined;
  useEffect(() => {
    if (openEntry) inboxRead.markRead(openEntry);
  }, [openEntry && readMark(openEntry)]);
  // answers in Seismic's sheet the owner has not seen: Seismic waits for them like a card
  const unread = kOn ? 0 : unreadAnswers(snapshot.talk);
  const nav = {
    project: snapshot.project,
    projects,
    counts,
    pinned,
    pinnable: !matchMedia(NARROW).matches && innerWidth - NAV_W - side.right >= NAV_PROJECT_MIN,
    onPin: pin,
    onNew: () => (showNewProject(), setPrefsOn(false), setCOn(true)),
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
    if (ids.length) showAck(t.archive.archivedMany(ids.length), () => Promise.all(ids.map((id) => api.unarchive(id))));
  }
  const attnLast = useRef<string | null>(null);
  /** The next card that needs the owner, in turn, and Seismic's sheet among them while an answer waits there. */
  function nextAttention() {
    const koordinator = !kOnRef.current && unreadAnswers(snapshotRef.current.talk) > 0;
    const all = itemsRef.current;
    const list: (Item | 'k')[] = [...all.filter(yours), ...(koordinator ? ['k' as const] : [])];
    if (!list.length || focusRef.current?.type === 'card') return;
    // the one after the card Tab opened last, by its place on the project: that card may need the owner no longer
    const key = (x: Item | 'k') => (x === 'k' ? 'k' : x.id);
    const at = (id: string | null) => (id === 'k' ? all.length : all.findIndex((i) => i.id === id));
    const last = at(attnLast.current);
    const next = list.find((x) => at(key(x)) > last) ?? list[0]!;
    attnLast.current = key(next);
    if (next === 'k') toggleKoordinator();
    else open(next);
  }
  /** The inbox slides out in place of Seismic's sheet or a plan's, and closes again. */
  const toggleInbox = () => {
    const open = !inboxOnRef.current;
    setInboxOn(open);
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
    setInboxOn(false);
    if (focusRef.current?.type === 'plan') closePlan(false);
  };
  /** The agents slide out in place of another sheet, and close again. */
  const toggleAgents = () => {
    const open = !agentsOnRef.current;
    setAgentsOn(open);
    if (!open) return;
    setKOn(false);
    if (focusRef.current?.type === 'plan') closePlan(false);
  };
  /**
   * "Go to card": the card opens beside the inbox, which stays open; one on another project opens
   * there, the inbox open beside it again. Seismic's answer opens its sheet in place of the inbox.
   */
  function goToEntry(e: InboxEntry) {
    if (e.project !== snapshot.project.id) return location.assign(e.card ? cardPath(e.project, e.card) : `${projectPath(e.project)}?talk`);
    if (!e.card) return kOnRef.current || toggleKoordinator();
    // the entry's own copy opens it when the project no longer lists the card (it just left the inbox)
    void openFresh(byId(e.card.id) ?? e.card);
  }
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const f = focusRef.current;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
    // a field being edited handles its own keys (Esc cancels the edit there); any other field's Esc closes what it is in
    if (typing && (e.target as Element).closest('[data-esc]')) return;
    // the configuration over the page takes the keys until it closes, Esc closing it
    if (cOnRef.current) {
      if (e.key === 'Escape' && !document.querySelector('.setup')) {
        e.preventDefault();
        setCOn(false);
      }
      return;
    }
    // so do the preferences
    if (prefsOn) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPrefsOn(false);
      }
      return;
    }
    // so does the performance dashboard
    if (perfOn) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPerfOn(false);
      }
      return;
    }
    // so does "Connect a phone"
    if (phoneOn) {
      if (e.key === 'Escape') setPhoneOn(false);
      return;
    }
    // so does the hint on how to create a task; Space and Enter press its button
    if (newHintOn) {
      if (e.key === 'Escape') setNewHintOn(false);
      return;
    }
    // the draft for Seismic's makers takes the keys until it closes, Esc closing it
    if (wishOn) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeWish();
      }
      return;
    }
    // the legend over the page takes the keys until it closes
    if (helpOn) {
      if (e.key === 'Escape' || e.key === '?') setHelpOn(false);
      // Space would press the focused button behind it
      if (e.key === 'Escape' || e.key === '?' || e.code === 'Space') e.preventDefault();
      return;
    }
    if (e.key === '/' && !typing && !focusRef.current && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
      e.preventDefault();
      closeBarMenus();
      setCardSearchOn(true);
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
    // hold Space anywhere but in a text field to speak; the demo pauses while the owner talks, and a tap plays or pauses it
    if (e.code === 'Space' && !typing) {
      e.preventDefault();
      if (!e.repeat) press(true);
      return;
    }
    if (e.key === 'Escape' && connection) { setConnection(null); return; }
    if (e.key === 'Escape') {
      // a screenshot or demo shown large closes first, a card's diff, the navigation's list and a card's "⋯"; the card or plan stays open
      if (document.querySelector('.lightbox, .demo-zoom, .artifact-image-close, .nav-menu, .diff-view, .start-agent-menu, .card-more-menu')) return;
      // so does the quote of a message the owner was replying to: in the field with the cursor, the open card's, the sidebar's
      const quoting = [focusedDraft(), f?.type === 'card' || f?.type === 'plan' ? cardDraft(f.id) : null, kOnRef.current ? OBEYA_DRAFT : null].find((k) => k && fieldOn(k) && replyOn(k));
      if (quoting) return setReply(quoting, null);
      // the archive's list closes after a card unfolded from it
      if (f?.type !== 'card' && aOnRef.current) return setAOn(false);
      // what is marked lets go before a sheet closes, once the colour ring for it has closed
      if (f?.type !== 'card' && !typing && !ring && marked.length) return setSelection([]);
      if (typing) (e.target as HTMLElement).blur();
      if (f?.type === 'card') closeCard();
      else if (kOnRef.current) setKOn(false);
      else if (inboxOnRef.current && f?.type !== 'plan') setInboxOn(false);
      else if (csOnRef.current && f?.type !== 'plan') setCsOn(false);
      else if (agentsOnRef.current && f?.type !== 'plan') setAgentsOn(false);
      else if (f?.type === 'plan' && readingRef.current && sheetPlan) readPlan(sheetPlan, null);
      else if (f?.type === 'plan') closePlan();
      return;
    }
    if (typing || f?.type === 'card' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '0') {
      setFocus(null);
      setSheetOn(false);
      fly(kept(overviewCam(all, sideNow())), 700);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      nextAttention();
    } else if (e.key === 'n' || e.key === 'c' || e.key === 'a') {
      // the key is the shortcut's alone: its character would land in the field the shortcut focuses (the archive's filter)
      e.preventDefault();
      if (e.key === 'n') createAtCentre();
      else if (e.key === 'c') talkKoordinator();
      else toggleArchive();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
  }, []);

  // ---------------------------------------------------------------- render
  const moveRef = useRef(moveCard);
  moveRef.current = moveCard;
  const canvasView = useMemo(() => ({ canvases, shown: canvasId, move: (i: Item, to: Canvas) => void moveRef.current(i, to) }), [canvases, canvasId]);
  const sheetPlan = sheetId ? itemOrArchived(sheetId) : undefined;
  const sheetKids = !sheetPlan ? [] : sheetPlan.archivedAt ? archived.filter((i) => i.parent === sheetPlan.id) : (kidsOf.get(sheetPlan.id) ?? []);
  // on touch nothing hovers: the card picked up and let go stands in for the one under the pointer
  const hovered = touchy ? touchFocus : hoverId;
  const deps = useMemo(() => (hovered && !panning && !dragId ? depsOf(hovered, items) : undefined), [hovered, panning, dragId, items]);
  const waits = useMemo(() => waitsAmong(items), [items]);
  const settled = useMemo(() => settledAmong(items), [items]);
  const waitKeys = useMemo(() => new Set([...waits, ...settled.map((d): [string, string] => [d.from, d.to])].map(([from, to]) => `${from}:${to}`)), [waits, settled]);
  // the waits shown as lines: those the owner is removing go at once
  const notRemoving = ([from, to]: [string, string]) => !removing.some((x) => x.key === `${from}:${to}`);
  const shownSettled = settled.filter((d) => notRemoving([d.from, d.to]));
  const shownWaits = waits.filter(([from, to]) => !removing.some((x) => x.key === `${from}:${to}`));
  const standsForId = (id: string) => (byId(id) ? standsFor(byId(id)!).id : id);
  // the waits whose other card lies on another canvas end in a stub with that canvas's icon
  const placedAt = new Map(placed.map((p) => [p.item.id, p.b]));
  const stubs = canvases.length > 1 ? stubsOf(shownWaits, new Set(placedAt.keys()), byId, standsForId, canvases, canvasId) : [];
  const depOf = (id: string) => (!deps ? undefined : id === hovered ? 'self' : deps.before.has(id) ? 'before' : deps.after.has(id) ? 'after' : undefined);
  // a workstream of a collapsed plan points to where its plan stands
  const at = new Map(placed.map((p) => [p.item.id, p.b]));
  const edgeTargets = items.flatMap((item) => {
    const b = at.get(standsFor(item).id);
    return b && yours(item) && (focus?.type !== 'plan' || item.parent === focus.id) ? [{ item, b }] : [];
  });

  // the button for the conversation with Seismic: the rightmost in the bar; while its sidebar is open it
  // belongs to the sidebar, at its top corner, and closes it. It is one element that never moves to
  // another parent, so opening and closing the sidebar only changes its colour; in the bar a hidden
  // copy keeps its room
  // the status bar's middle, where the line naming whom the microphone speaks to stands
  const [targetSlot, setTargetSlot] = useState<HTMLElement | null>(null);
  const talkButton = (
    <button className={kOn ? 'pill kpill talk-pill on' : 'pill kpill talk-pill'} title={t.koordinator.buttonTitle} aria-label={t.koordinator.button} onClick={talkKoordinator}>
      <TalkIcon />
      {unread > 0 && (
        <span className="n unread" title={t.koordinator.unreadCount(unread)}>
          {unread}
        </span>
      )}
    </button>
  );

  return (
    <HoldToTalk.Provider value={holdToTalk}>
    <OpenPerformance.Provider value={openPerformance}>
    <KoordinatorAgent.Provider value={snapshot.koordinatorAgent}>
    <Canvases.Provider value={canvasView}>
      <div
        className={[cam.s < FAR && 'z-far', resizing && 'resizing'].filter(Boolean).join(' ') || undefined}
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
          className={[panning && 'panning', ring && 'still', touchy && 'touch'].filter(Boolean).join(' ') || undefined}
          style={{ backgroundSize: `${22 * cam.s}px ${22 * cam.s}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
        >
          <div id="world" style={{ transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.s})` }}>
            <TerritoryLayer {...territories} selected={placed.filter((p) => (ring ? ring.ids : marked).includes(p.item.id)).map((p) => p.b)} />
            <Links placed={placed} waits={[...shownWaits, ...shownSettled.map((d): [string, string] => [d.from, d.to])]} standsFor={standsForId} />
            <DepLinks placed={placed} waits={shownWaits} lit={deps?.edges ?? []} first={deps?.first} settled={shownSettled} standsFor={standsForId} routeOf={routeOf} s={cam.s}>
              {/* an arrow the owner drew: under the pointer, a trash button that removes it, where no card
                  covers it; the button and the band that shows it keep their size on screen at every zoom */}
              {placed.flatMap(({ item, b }) => (connectable(item) ? item.plan?.manualDependsOn ?? [] : []).filter((from) => waitKeys.has(`${from}:${item.id}`) && !removing.some((x) => x.key === `${from}:${item.id}`)).flatMap((from) => {
                const a = placed.find((p) => p.item.id === from && connectable(p.item))?.b;
                if (!a) return [];
                const r = 13 / cam.s;
                // an arrow drawn at chosen edges: its button on the middle of its route
                const anchor = item.plan?.manualAnchors?.[from];
                const routed = anchor && anchoredPath(a, b, anchor, depHead(cam.s));
                const { x, y } = routed ? routed.mid : linkSpot(a, b, depHead(cam.s), cardBoxes, r);
                // on touch, the trash button shows on the arrows of the card picked up and let go
                const shown = touchy && (touchFocus === from || touchFocus === item.id);
                return [<g className={shown ? 'manual-edge shown' : 'manual-edge'} key={`${from}:${item.id}`}>
                  <path className="manual-hit" d={routed ? routed.path : linkPath(a, b, depHead(cam.s))} strokeWidth={22 / cam.s} />
                  <foreignObject x={x - r} y={y - r} width={2 * r} height={2 * r}><button title={t.deps.remove} aria-label={t.deps.remove} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); removeDependency(from, item); }}><Trash2 strokeWidth={2} /></button></foreignObject>
                </g>];
              }))}
              <CanvasStubs stubs={stubs} boundsOf={(id) => placedAt.get(id)} s={cam.s} onOpen={(i) => void openFresh(i)} />
            </DepLinks>
            <svg className="manual-deps" width="1" height="1">
              <defs><marker id="manual-arrow" viewBox="0 0 9 8" refX="0.3" refY="4" markerWidth={6} markerHeight={(6 * 8) / 9} markerUnits="strokeWidth" orient="auto"><path d="M0,0 L9,4 L0,8 z" /></marker><marker id="ghost-arrow" viewBox="0 0 9 8" refX="9" refY="4" markerWidth={6} markerHeight={(6 * 8) / 9} markerUnits="strokeWidth" orient="auto"><path d="M0,0 L9,4 L0,8 z" /></marker></defs>
              {connection && (() => { const a = placed.find((p) => p.item.id === connection.from)?.b; if (!a) return null; const start = handleAt(a, connection.side); const b = placed.find((p) => p.item.id === connection.target)?.b; const path = b ? (connection.anchor ? anchoredPath(a, b, connection.anchor, depHead(cam.s)).path : linkPath({ ...start, w: 0, h: 0 }, b, depHead(cam.s))) : `M${start.x},${start.y} L${connection.x},${connection.y}`; return <path className="manual-ghost" d={path} strokeWidth={depWidth(cam.s)} markerEnd={b ? "url(#manual-arrow)" : "url(#ghost-arrow)"} />; })()}
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
                  onArchive={archiveCard}
                  dep={depOf(item.id)}
                  underway={underway[item.id] ?? (item.review?.landing ? t.approving : undefined)}
                  onHover={setHoverId}
                />
              ),
            )}
            {placed.filter(({ item }) => connectable(item)).map(({ item, b }) => <div key={`handles:${item.id}`} data-id={item.id} className={`connection-handles ${cardClass(item, underway[item.id]).replace(/^card\s*/, '')}${depOf(item.id) ? ' dep-highlight' : ''}${connection?.target === item.id ? ' target' : ''}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
              {SIDES.map((side) => <button key={side} className={`connection-dot ${side}${!connection && (handle?.id === item.id && handle.side === side || touchDots(item.id)) ? ' visible' : ''}`} title={t.deps.connect} aria-label={t.deps.connect} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); const p = toWorld(camRef.current, e.clientX, e.clientY); setConnection({ from: item.id, side, ...p }); }} />)}
            </div>)}
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
                onChange={() => {
                  showProjectsSection();
                  setCOn(true);
                }}
                onHide={() => hideNote(d)}
              />
            ))}
            <GroupNames shapes={territories.shapes} />
          </div>
        </div>
        {/* on an empty project the camera centres the notes on the plan directories: the hint stands above them, with space between */}
        {!placed.length && (
          <div className={notes.length ? 'empty above-note' : 'empty'} {...(notes.length ? { style: { top: cam.y + Math.min(...notes.map((b) => b.y)) * cam.s - 48 } } : {})}>
            <p className="none">{t.empty.none}</p>
            <p>{t.empty.speak}</p>
            <p className="where">{t.empty.where}</p>
            <p>{coarse || touchy ? t.touch.emptyTap : t.empty.click}</p>
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
          <p id="touchhint">
            {t.touch.hold}
            <button onClick={learnHold}>{t.touch.ok}</button>
          </p>
        )}
        {connection && !depKnown && (
          <p id="dephint" style={{ left: cam.x + connection.x * cam.s, top: cam.y + connection.y * cam.s }}>
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
        {/* in the app on a Mac the bar is the window's title bar: it moves the window (app/src/main.rs); beside the pinned navigation, the traffic lights sit in that */}
        <header id="bar" ref={barRef} {...(window.obeyaApp?.platform === 'macos' ? { className: side.left ? 'titlebar beside-nav' : 'titlebar', 'data-tauri-drag-region': '' } : {})}>
          {extensions.map((e, i) => { const Slot = e.slots?.topBar; return Slot ? <Slot key={i} /> : null; })}
          <AppMenu
            onPerformance={openPerformance}
            onFeedbackLog={() => location.assign(feedbackLogPath(snapshot.project.id))}
            onPrefs={openPrefs}
            onConfig={toggleConfig}
            onHelp={() => {
              setHelpNote(undefined);
              setHelpOn(true);
            }}
          />
          {/* beside the pinned navigation the bar heads the project with its name, which the navigation's button gave before */}
          {side.left ? (
            <h1 className="bar-project" title={snapshot.project.name} {...(window.obeyaApp?.platform === 'macos' ? { 'data-tauri-drag-region': '' } : {})}>
              {snapshot.project.name}
            </h1>
          ) : (
            <NavPill {...nav} />
          )}
          <ArchivePill
            on={aOn}
            onToggle={toggleArchive}
            onClose={() => setAOn(false)}
            held={focus?.type === 'card'}
            archived={archived}
            done={doneCount}
            onOpen={open}
            onArchiveDone={() => archiveDone().catch(console.error)}
            els={archiveEls}
            icon={<BarIcon icon={Archive} />}
          />
          {!focus && <button className="pill card-search-button" title={t.cardSearch.shortcut} aria-label={t.cardSearch.shortcut} aria-expanded={cardSearchOn} onClick={() => { closeBarMenus(); setCardSearchOn((on) => !on); }}>
            <BarIcon icon={Search} /> <span>/</span>
          </button>}
          {!dblKnown && (
            <button className="pill new-card" title={t.newCard} onClick={() => focusRef.current?.type !== 'card' && setNewHintOn(true)}>
              + <span className="lbl">{t.newCard}</span>
            </button>
          )}
          {!helpKnown && (
            <HelpButton
              on={helpOn}
              onClick={() => {
                setHelpNote('button');
                setHelpOn(!helpOn);
              }}
            />
          )}
          <div className="right">
            {oldBun && <OldBunPill version={oldBun} />}
            {online && update && restart?.reason !== 'update' && <UpdatePill update={update} />}
            {online && source && <SourcePill source={source} />}
            {snapshot.workstations && <WorkstationsPill pools={snapshot.workstations} project={snapshot.project} projects={projects} items={items} onOpen={(i) => void openFresh(i)} onElsewhere={(c, card) => location.assign(cardPath(c, card))} onTake={takeWorkstation} onKeep={keepWorkstation} />}
            <button className={csOn ? 'pill kpill cs-pill on' : 'pill kpill cs-pill'} title={t.projectSettings.button} aria-label={t.projectSettings.button} aria-expanded={csOn} onClick={toggleProjectSettings}>
              <BarIcon icon={Settings} />
              {configProblems > 0 && (
                <span className="n err" title={t.config.problemCount(configProblems)}>
                  {configProblems}
                </span>
              )}
            </button>
            <button className={agentsOn ? 'pill kpill agents-pill on' : 'pill kpill agents-pill'} title={t.agents.button(queued)} aria-label={t.agents.button(queued)} aria-expanded={agentsOn} onClick={toggleAgents}>
              <BarIcon icon={Bot} />
              {queued > 0 && <span className="n">{queued}</span>}
            </button>
            <button className={inboxOn ? 'pill kpill inbox-pill on' : 'pill kpill inbox-pill'} id="attention" title={t.inbox.button(attentionCount)} aria-label={t.inbox.button(attentionCount)} aria-expanded={inboxOn} onClick={toggleInbox}>
              <BarIcon icon={Inbox2} />
              {attentionCount > 0 && <span className="n">{attentionCount}</span>}
            </button>
            {!kOn && (
              <div className="talk-room" aria-hidden>
                {talkButton}
              </div>
            )}
          </div>
        </header>
        {cardSearchOn && !focus && <CardSearch items={items} onOpen={(item) => void openFresh(item)} onClose={() => setCardSearchOn(false)} />}
        {/* the status bar along the bottom: the connection (or the restart that waits), whom the microphone speaks to, the usage limits */}
        <footer id="status">
          <div className="st-left">
            {!online || frozen ? <ConnectionLost since={downSince} frozen={frozen} /> : restart ? <RestartPill restart={restart} items={items} /> : <span className="st online">{t.online}</span>}
            {online && snapshot.project.demoSite?.init?.running && <span className="st site-init">{t.creatingSite}</span>}
          </div>
          <div className="st-mid" ref={setTargetSlot} />
          <div className="st-right">{online && usage && <UsagePill usage={usage} />}</div>
        </footer>
        <NavSheet on={side.left > 0} {...nav} />
        <Minimap
          cam={cam}
          side={side}
          all={all}
          placed={placed}
          territories={territories.shapes}
          onJump={(wx, wy) => !focusRef.current && fly(viewOn(wx, wy), 500)}
          onFollow={(wx, wy) => !focusRef.current && chase(camRef.current, viewOn(wx, wy), setCam)}
        />
        <CanvasTabs project={snapshot.project.id} canvases={canvases} shown={canvasId} waiting={perCanvas.waiting} empty={perCanvas.empty} onShow={(c) => (focusRef.current?.type === 'plan' && closePlan(), showCanvas(c))} />
        <Inbox entries={entries} current={snapshot.project.id} open={(focus?.type === 'card' ? focus.id : openId) ?? undefined} on={inboxOn} onGo={goToEntry} onReply={replyTo} isRead={inboxRead.isRead} onRead={inboxRead.markRead}
          onProposalCard={(project, card) => goToEntry({ key: card.id, project, projectName: '', card, text: '', since: '' })}
          onProposalConfig={(project, repo, setting) => { showRepoClones({ project, repo, field: 'settings', setting }); setCOn(true); }} />
        <AgentsSheet els={sheetEls} on={agentsOn} items={items} open={openId ?? undefined} underway={(id) => !!underway[id]} onOpen={(i) => void openFresh(i)} project={snapshot.project.id} changed={snapshot} onGo={(project, card) => goToEntry({ key: card.id, project, projectName: '', card, text: '', since: '' })} />
        <ProjectSettingsSheet project={snapshot.project.id} name={snapshot.project.name} homePath={snapshot.project.repos[0]?.path} onAddSite={() => (showAddSite(), setPrefsOn(false), setCOn(true))} on={csOn} covered={cOn} problems={configProblems} onConfig={() => (showProjectsSection(), setPrefsOn(false), setCOn(true))} />
        <div id="dim" className={dim ? 'on' : undefined} onClick={() => closeCard()} />
        {helpOn && <Help note={helpNote} onClose={() => setHelpOn(false)} />}
        <WishDialog />
        {newHintOn && <NewCardHint text={coarse || touchy ? t.touch.newCard : t.newCardHint.text} onClose={() => setNewHintOn(false)} />}
        <div id="panel" ref={panelRef}>
          <button className="close" title={t.close} onClick={() => closeCard()}>
            ✕
          </button>
          <div className="inner card-sheet" ref={innerRef}>
            <div className="content">
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
                    showRepoClones({ project: snapshot.project.id, repo, field });
                    setCOn(true);
                  }}
                  onDemoSites={() => {
                    // the project chooses its demo site in its settings
                    closeCard();
                    if (!csOnRef.current) toggleProjectSettings();
                  }}
                  onEdit={onEdit}
                  flush={flushEdit}
                  onDelete={deleteOpen}
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
          page={snapshot.project.id}
          onClose={() => setCOn(false)}
          onSetup={() => setSetupOn(true)}
          onTalk={talkFromConfig}
          onProblems={setConfigProblems}
          revs={configRevs}
          onConnect={() => (setCOn(false), setPhoneOn(true))}
          onAsk={(text, project) => void told.tell(t.voice.reading(t.voice.koordinator), undefined, () => (project ? api.commandOn(project, text) : api.command(text, null, { place: placeNow() })))}
        />
        <PrefsDialog
          preferences={snapshot.preferences} repos={snapshot.project.repos}
          on={prefsOn}
          onClose={() => setPrefsOn(false)}
          onConfig={() => {
            setPrefsOn(false);
            setCOn(true);
          }}
        />
        {setupOn && <Setup onClose={() => setSetupOn(false)} />}
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
        <KoordinatorSheet on={kOn} onClose={toggleKoordinator} project={snapshot.project.id} projectName={snapshot.project.name} items={items} preferences={snapshot.preferences} settings={snapshot.settingProposals ?? []} repos={snapshot.project.repos} talk={snapshot.talk} chat={snapshot.chat} chatModel={snapshot.chatModel} chats={snapshot.chats} reshare={snapshot.reshare} onOpen={(i) => void openFresh(i)} onTell={(text, images, replyTo) => tellTyped(text, images, null, undefined, replyTo)} onProject={(c) => location.assign(`${projectPath(c)}?talk`)} onConfig={(repo, setting) => {
            showRepoClones({ project: snapshot.project.id, repo, field: 'settings', setting });
            setCOn(true);
          }} />
        <PushToTalk
          phase={ptt.phase}
          level={ptt.level}
          flat={ptt.flat}
          target={target}
          field={draftFor(where())}
          slot={targetSlot}
          onDown={() => press(false)}
        />
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
        <div id="talk-docked" className={kOn ? 'on' : undefined}>
          {talkButton}
        </div>
        {gripOn && !kOn && (
          <button id="sheet-close" title={t.close} onClick={() => (sheetOn ? closePlan() : (setInboxOn(false), setCsOn(false), setAgentsOn(false)))}>
            ✕
          </button>
        )}
        <div
          id="sheet-grip"
          className={gripOn ? 'on' : undefined}
          style={{ right: sheetW[gripKind] - 6 }}
          title={t.sheetGrip}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onDoubleClick={() => setWidths((ws) => ({ ...ws, [gripKind]: gripKind === 'sheet' ? SHEET_W : null }))}
        />
        {/* commands on their way and confirmations, stacked above the microphone */}
        <div id="acks">
          <Toasts toasts={toasts} open={focus?.type === 'card' ? focus.id : undefined} />
          {/* nearest the microphone: a line going above it does not move the stars under a finger */}
          {ratePrompt.prompt}
          <NotifyAsk {...notifyAsk} />
        </div>
        <PerformanceDialog initial={perfAtStart} on={perfOn} onClose={() => setPerfOn(false)} projects={projects} here={snapshot.project.id} onOpenCard={(code) => void openNamed(code).catch(console.error)} />
      </div>
    </Canvases.Provider>
    </KoordinatorAgent.Provider>
    </OpenPerformance.Provider>
    </HoldToTalk.Provider>
  );
}

/**
 * Where the unfolded card sits: in the middle of the project between the panels `side`, reaching over
 * the sheet where the project is too narrow for it, as tall as its content needs up to a limit, beyond
 * which it scrolls. Lays the content out at the final width
 * to measure it, so call it with the content rendered.
 */
function panelRect(i: Item, inner: HTMLElement, side: Sides) {
  const tall = i.state !== 'planned' && i.state !== 'proposal';
  // a card with a conversation beside what it is about (an idea, a proposal, a task an agent worked on) gets the room of the mock's demo panel
  const wide = split(i);
  // a task an agent works on without a result yet is its conversation alone, and only as wide
  const want = wide ? 1600 : talkAlone(i) ? TALK_W : tall ? 980 : 900;
  // the sheet lies dimmed under an open card, so a card wider than the project reaches over it; the
  // pinned navigation, which stays usable beside it, limits it unless the window leaves less than a
  // conversation's width beside the navigation
  const room = innerWidth - side.left - 80;
  const W = Math.min(want, Math.max(room, Math.min(TALK_W, innerWidth - 80)));
  inner.style.width = `${W}px`;
  inner.style.removeProperty('--pb');
  inner.style.overflowY = '';
  const pad = getComputedStyle(inner);
  const base = parseFloat(pad.paddingBottom);
  const content = inner.firstElementChild as HTMLElement;
  // heights unrounded: a content half a pixel higher than its panel scrolls it
  const height = (e: HTMLElement) => e.getBoundingClientRect().height;
  const mic = (document.getElementById('ptt')?.getBoundingClientRect().top ?? innerHeight) - MIC_GAP;
  // a split (an idea, a proposal, a task) grows with its taller column up to the room from the top
  // of the window down to the microphone: beyond that its columns scroll, and the panel itself does not
  const fill = content.querySelector<HTMLElement>('.split');
  if (fill) {
    fill.style.minHeight = fill.style.maxHeight = '';
    if (!matchMedia(NARROW).matches) {
      const rest = height(content) - height(fill) + parseFloat(pad.paddingTop) + base;
      const room = Math.floor(mic - PANEL_TOP_OVER - rest);
      fill.style.minHeight = `${SPLIT_MIN}px`;
      fill.style.maxHeight = `${Math.max(SPLIT_MIN, room)}px`;
      // nothing to scroll to, so no scrollbar either; on a low window the panel scrolls past the microphone
      if (room >= SPLIT_MIN) inner.style.overflowY = 'hidden';
    }
  }
  const need = height(content) + parseFloat(pad.paddingTop) + base;
  // any other panel grows with its content up to the same room and scrolls beyond it; only a window
  // too low for SPLIT_MIN lets it reach under the microphone
  const toMic = Math.floor(mic - PANEL_TOP_OVER);
  const max = Math.min(fill ? Infinity : Math.max(toMic, SPLIT_MIN), innerHeight - PANEL_TOP_OVER - PANEL_BOTTOM);
  // in the middle of the window below the top bar, ending above the microphone. A panel too tall for
  // the room below the bar reaches over the bar, which the dim covers while a card is open, so a low
  // window still shows much of the card
  const top = (H: number) => Math.max(PANEL_TOP_OVER, Math.min(Math.max(PANEL_TOP, (innerHeight - H) / 2), mic - H));
  // the microphone sits over the bottom of a tall panel: the content gets room below it to scroll
  // up past the microphone, and the panel grows by that room where it can
  const under = (H: number) => Math.max(0, top(H) + H - mic - base);
  let H = Math.min(Math.ceil(need), max);
  H = Math.min(Math.ceil(need + under(H)), max);
  const extra = under(H);
  // through --pb, which the card's sticky row of decisions reaches down over too (styles.css)
  if (extra) inner.style.setProperty('--pb', `${base + extra}px`);
  // in the middle of the project where it fits there, else as near to it as the window allows
  const lo = W <= room ? side.left + 40 : 40;
  return { left: `${Math.max(lo, Math.min(midX(side) - W / 2, innerWidth - W - 40))}px`, top: `${top(H)}px`, width: `${W}px`, height: `${H}px` };
}

/** A panel holding a conversation alone: its column at its widest (560 px, styles.css) and the panel's padding. */
const TALK_W = 640;
/** Below this the split's columns stack (styles.css) and the panel scrolls as a whole. */
const NARROW = '(max-width: 760px)';

/** Where a panel starts at the top: below the bar. */
const PANEL_TOP = 64;
/** Where a panel too tall for the room below the bar starts instead, over the bar. */
const PANEL_TOP_OVER = 12;
/** The least room a panel keeps at the bottom of the window, on a window too low to end it above the microphone. */
const PANEL_BOTTOM = 46;
/** The least height of a split (an idea, a proposal, a task) and of a panel that scrolls: on a low window the panel reaches under the microphone instead. */
const SPLIT_MIN = 320;

/** Room between the panel's content and the microphone. */
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
  return <I className="bar-icon" size={16} strokeWidth={2} aria-hidden />;
}

