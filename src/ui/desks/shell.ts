// The desktop app's workspaces (a workspace is a *desk* in code): the Seismics its window can show,
// this machine's and the remote ones the owner paired. The shell keeps the list (desktop/src/desks/);
// every page in the app reads it and switches through the shell's commands, and only this machine's
// page may change it. A browser or a phone has no shell: none of this shows there.

import { useSyncExternalStore } from 'react';
import { goTo, pushAddress } from '../address';
import { holdLeaving, leave } from '../leaving';
import { t } from '../strings';

export interface Desk {
  id: string;
  /** The name to show: the owner's, else the machine's (this machine's) or the host (a remote one's). */
  name: string;
  /** A remote one's origin (`https://studio.tail1234.ts.net`); null for this machine's. */
  origin: string | null;
  local: boolean;
  /** The one this window shows. */
  open: boolean;
}

export interface DeskList {
  /** The workspace the calling page is of; null while the window is about to show another. */
  current: string | null;
  /** Why the status page shows in place of the current workspace. */
  problem: string | null;
  list: Desk[];
}

/** This machine's workspace, always on the list. */
export const LOCAL = 'local';
/** This machine's page that lists the workspaces; `?new` opens the form to pair one, `?edit=<id>` the dialog of one. */
export const WORKSPACES_PATH = '/workspaces';

type DeskPageAction = 'ask' | 'commit' | 'cancel';
type DeskPageResult = 'waiting' | 'pending' | 'ready' | 'opened' | 'cancelled';

declare global {
  interface Window {
    /** Resolves the leave guard and commits the route only while its native selection is current. */
    seismicDeskPage?: (page: string, id: string, action: DeskPageAction) => DeskPageResult;
  }
}

type Tauri = { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
const tauri = () => (window as unknown as { __TAURI_INTERNALS__?: Tauri }).__TAURI_INTERNALS__;

/** Whether the page is in the desktop app's window, whose shell keeps the workspaces. */
export const inApp = () => !!window.seismicApp && !!tauri();

/** A shell command; its error is the shell's code (desktop/src/desks/commands.rs). */
const call = <T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  const app = tauri();
  return app ? app.invoke<T>(cmd, args) : Promise.reject(new Error('not in the app'));
};

let pairing = false;
const pairingListeners = new Set<() => void>();
const subscribePairing = (listener: () => void) => {
  pairingListeners.add(listener);
  return () => { pairingListeners.delete(listener); };
};

export const usePairing = () => useSyncExternalStore(subscribePairing, () => pairing);

/** Keep the initiating form in view until pairing either switches workspaces or returns its result. */
async function whilePairing<T>(run: () => Promise<T>): Promise<T> {
  if (pairing) throw new Error('window');
  const release = holdLeaving(() => true, true);
  pairing = true;
  pairingListeners.forEach((tell) => tell());
  try {
    return await run();
  } finally {
    release();
    pairing = false;
    pairingListeners.forEach((tell) => tell());
  }
}

export const desks = {
  list: () => call<DeskList>('desks'),
  /** Shows workspace `id` in the window; this machine's at `page`, its workspaces page, where given. */
  open: (id: string, page?: string) => call('open_desk', page ? { id, page } : { id }),
  /** Pairs with the Seismic at `address` by the code of its "Connect a phone", and keeps it on the list. */
  add: (address: string, code: string, name: string) => whilePairing(() => call<{ id: string; opened: boolean }>('add_desk', { address, code, name: name.trim() || null })),
  /** Blank gives it back its default name. */
  rename: (id: string, name: string) => call('rename_desk', { id, name }),
  /** Pairs again by a new code, at a new `address` where it moved. */
  pair: (id: string, code: string, address?: string) => whilePairing(() => call<{ opened: boolean }>('pair_desk', address ? { id, code, address } : { id, code })),
  remove: (id: string) => call('remove_desk', { id }),
};

// One read for the whole page, the switcher's and the workspaces page's alike, read again whenever
// the shell says the list changed (`seismic-desks`, desktop/src/desks/mod.rs `changed`).
let shown: DeskList | null = null;
let failed = false;
let reads = 0;
const listeners = new Set<() => void>();
const told = () => listeners.forEach((l) => l());

/** Reads the list again; only the latest read's answer counts. */
export function readDesks() {
  const n = ++reads;
  desks.list().then(
    (l) => n === reads && ((shown = l), (failed = false), told()),
    (e) => n === reads && (console.error(e), (failed = true), told()),
  );
}

function subscribe(listener: () => void) {
  if (!listeners.size && inApp()) {
    addEventListener('seismic-desks', readDesks);
    readDesks();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) removeEventListener('seismic-desks', readDesks);
  };
}

/** The workspaces, null outside the app, until the shell answered, and where it has no workspaces. */
export function useDesks(): DeskList | null {
  return useSyncExternalStore(subscribe, () => shown);
}

/** Whether the last read of the list failed. */
export function useDesksFailed(): boolean {
  return useSyncExternalStore(subscribe, () => failed);
}

/** The workspace the page is of. */
export const currentDesk = (all: DeskList | null) => all?.list.find((d) => d.id === all.current);

/** Whether the page is this machine's Seismic in the app: the one that may change the list. */
export const onThisMachine = (all: DeskList | null) => all?.current === LOCAL;

/**
 * Goes to this machine's workspaces page (`query`: `?new`, `?edit=<id>`): in place on this
 * machine's page, else the window switches there.
 */
export function openWorkspaces(all: DeskList | null, query = '') {
  const path = `${WORKSPACES_PATH}${query}`;
  if (onThisMachine(all)) {
    if (pairing) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      leave(() => {
        showWorkspaces(path);
        resolve(true);
      }, path, () => resolve(false));
    });
  }
  return desks.open(LOCAL, path).then(() => true);
}

function showWorkspaces(path: string) {
  rememberBack();
  pushAddress(path);
}

const BACK = 'seismic-workspaces-back';
/** Where the workspaces page's "Back" leads: the page it was opened from. */
function rememberBack() {
  if (location.pathname === WORKSPACES_PATH) return;
  try {
    sessionStorage.setItem(BACK, `${location.pathname}${location.search}`);
  } catch {}
}
export function backFromWorkspaces() {
  let to = '/';
  try {
    to = sessionStorage.getItem(BACK) ?? '/';
    sessionStorage.removeItem(BACK);
  } catch {}
  goTo(to.startsWith(WORKSPACES_PATH) ? '/' : to);
}

/** The shell sends this machine's page shown already to its workspaces page (menu, a remote page's switcher). */
export function followShell() {
  if (!inApp()) {
    // a browser has no workspaces page: its address shows the projects
    if (location.pathname === WORKSPACES_PATH) history.replaceState(history.state, '', '/');
    return;
  }
  let request: { id: string; from: string; decision: DeskPageResult; controller: AbortController } | undefined;
  window.seismicDeskPage = (page, id, action) => {
    if (action === 'cancel') {
      if (request?.id === id) {
        request.controller.abort();
        request.decision = 'cancelled';
      }
      return 'cancelled';
    }
    if (pairing || !(page === WORKSPACES_PATH || page.startsWith(`${WORKSPACES_PATH}?`))) return 'waiting';
    if (request?.id !== id) {
      if (action !== 'ask') return 'waiting';
      request?.controller.abort();
      const next = { id, from: location.href, decision: 'pending' as DeskPageResult, controller: new AbortController() };
      request = next;
      leave(() => { next.decision = 'ready'; }, page, () => { next.decision = 'cancelled'; }, next.controller.signal);
    }
    if (action === 'commit' && request.decision === 'ready') {
      if (request.from !== location.href) return 'cancelled';
      showWorkspaces(page);
      request.decision = 'opened';
    }
    return request.decision;
  };
}

/** A pasted pairing link (`https://studio…/pair?code=482913`) as its address and code. */
export function fromPairingLink(text: string): { address: string; code: string } | null {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const code = url.searchParams.get('code');
    return url.pathname === '/pair' && code && /^\d{6}$/.test(code) ? { address: url.origin, code } : null;
  } catch {
    return null;
  }
}

/** The address as an origin, with `https://` where none is written (as `tailscale serve` gives it); null for no address. */
export function originOf(text: string): string | null {
  const a = text.trim();
  if (!a) return null;
  try {
    const url = new URL(a.includes('://') ? a : `https://${a}`);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? url.origin : null;
  } catch {
    return null;
  }
}

/** What the shell's error `e` says to the owner, about the address `address`. */
export function deskError(e: unknown, address = ''): string {
  const code = e instanceof Error ? e.message : String(e);
  const w = t.desks.error;
  if (code === 'unreachable' || code === 'notSeismic') return w[code](address);
  return Object.hasOwn(w, code) && typeof w[code as keyof typeof w] === 'string' ? (w[code as keyof typeof w] as string) : w.other(code);
}

/** The user guide's page on workspaces in the desktop app, which "Learn more" opens. */
export const GUIDE = 'https://seismic.im/docs/workspaces/';
