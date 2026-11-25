




export type SideSheet = 'koordinator' | 'needs-you' | 'settings' | 'agents' | 'archive';

export interface Kept {
  at: number;
  
  card?: string;
  plan?: string;
  
  reading?: boolean;
  sheet?: SideSheet;
  
  config?: boolean;
  
  prefs?: boolean;
  
  scroll: [string, number][];
  
  drafts: [string, string][];
  video?: { time: number; playing: boolean };
}


export const ROOTS = ['panel', 'sheet', 'ksheet', 'nav', 'amenu', 'config'];


const FRESH_MS = 5 * 60_000;
export const keptKey = (project: string) => `seismic-kept-${project}`;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function keep(store: Store, project: string, kept: Kept) {
  try {
    store.setItem(keptKey(project), JSON.stringify(kept));
  } catch {}
}

/** What the reload before this page kept, once. */
export function takeKept(store: Store, project: string, now = Date.now()): Kept | null {
  try {
    const raw = store.getItem(keptKey(project));
    store.removeItem(keptKey(project));
    const k = raw ? (JSON.parse(raw) as Kept) : null;
    return k && now - k.at < FRESH_MS ? k : null;
  } catch {
    return null;
  }
}

const kindOf = (el: Element) =>
  el instanceof HTMLTextAreaElement ? `textarea[${el.placeholder}]` : `${el.tagName.toLowerCase()}.${[...el.classList].sort().join('.')}`;

/**
 * A name for `el` that finds it again in the page that loads: its root, what it is, and which of
 * its kind there it is. Text fields go by their placeholder, other boxes by their class.
 */
export function place(root: Element, el: Element): string {
  if (el === root) return JSON.stringify([root.id]);
  const kind = kindOf(el);
  return JSON.stringify([root.id, kind, [...root.querySelectorAll('*')].filter((x) => kindOf(x) === kind).indexOf(el)]);
}

/** The element `place` named, if the page has it. */
export function find(name: string): Element | undefined {
  const [rootId, kind, i] = JSON.parse(name) as [string, string?, number?];
  const root = document.getElementById(rootId) ?? undefined;
  if (!root || kind === undefined) return root;
  return [...root.querySelectorAll('*')].filter((x) => kindOf(x) === kind)[i!];
}

/** The scrolled boxes and the drafts in the open things. */
export function collect(): Pick<Kept, 'scroll' | 'drafts' | 'video'> {
  const scroll: [string, number][] = [];
  const drafts: [string, string][] = [];
  for (const id of ROOTS) {
    const root = document.getElementById(id);
    if (!root) continue;
    for (const el of [root, ...root.querySelectorAll('*')]) if (el.scrollTop > 0) scroll.push([place(root, el), el.scrollTop]);
    
    if (id !== 'config') for (const el of root.querySelectorAll('textarea')) if (el.value.trim()) drafts.push([place(root, el), el.value]);
  }
  const v = document.querySelector<HTMLVideoElement>('#panel video');
  return { scroll, drafts, ...(v && v.currentTime > 0 && !v.ended ? { video: { time: v.currentTime, playing: !v.paused } } : {}) };
}


const SETTLE_MS = 2500;

const WAIT_MS = 20_000;

/**
 * Until when the positions are put back: `SETTLE_MS` past the last moment a box was not back
 * where it was (not there yet, or its content too short to scroll that far), within `WAIT_MS` of
 * the start.
 */
export const settleUntil = (start: number, until: number, now: number, short: boolean) => (short ? Math.min(start + WAIT_MS, Math.max(until, now + SETTLE_MS)) : until);

/**
 * Puts back what `collect` found, in the page as it loads: content that arrives later (a log, a
 * plan doc, the configuration's sections) moves boxes and makes them tall enough, so the positions
 * are put back again until the content has settled, unless the owner scrolls or types first.
 */
export function restore(k: Pick<Kept, 'scroll' | 'drafts' | 'video'>): () => void {
  const start = performance.now();
  let until = start + SETTLE_MS;
  const drafts = new Map(k.drafts);
  let stop = false;
  const owner = () => void (stop = true);
  const events = ['wheel', 'pointerdown', 'keydown'] as const;
  for (const e of events) addEventListener(e, owner, { capture: true, once: true });
  let video = k.video;
  const tick = () => {
    if (stop || performance.now() > until) return void events.forEach((e) => removeEventListener(e, owner, { capture: true }));
    let short = false;
    for (const [name, top] of k.scroll) {
      const el = find(name);
      if (el && el.scrollTop !== top) el.scrollTop = top;
      
      if (!el || Math.abs(el.scrollTop - top) > 1) short = true;
    }
    until = settleUntil(start, until, performance.now(), short);
    
    for (const [name, text] of drafts) {
      const el = find(name);
      if (!(el instanceof HTMLTextAreaElement)) continue;
      drafts.delete(name);
      if (el.value) continue;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const v = video && document.querySelector<HTMLVideoElement>('#panel video');
    if (video && v && v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      v.currentTime = video.time;
      
      if (video.playing && !document.hidden) v.play().catch(() => {});
      video = undefined;
    }
    setTimeout(tick, 100);
  };
  tick();
  
  return owner;
}

export const sheetKey = (project: string) => `seismic-sheet-left-open-${project}`;

/**
 * Whether the owner left the project (for another project, or a reload) with Seismic's sheet open and
 * something typed in its field: back on it, the sheet is open again. An empty field, or a sheet
 * closed as they left, leaves it closed.
 */
export function leaveSheet(store: Store, project: string, openWithDraft: boolean) {
  try {
    if (openWithDraft) store.setItem(sheetKey(project), '1');
    else store.removeItem(sheetKey(project));
  } catch {}
}

/** Whether the owner left the project with Seismic's sheet open over a draft, once. */
export function takeSheetLeft(store: Store, project: string): boolean {
  try {
    const open = store.getItem(sheetKey(project)) === '1';
    store.removeItem(sheetKey(project));
    return open;
  } catch {
    return false;
  }
}
