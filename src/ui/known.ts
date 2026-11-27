import { useSyncExternalStore } from 'react';

const HINT_KEY = /^seismic-.+-known$/;

const HINTS_OFF = 'seismic-hints-off';

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const gone = new Set<string>();

let off: boolean | undefined;

/**
 * Another tab of this browser changed what it stores: a hint it dismissed, a reset (keys removed,
 * or the whole storage cleared) or the toggle. This page's own memory of those follows, so its
 * hints show what that tab shows.
 */
export function heardStorage(key: string | null, value: string | null) {
  if (key === null) {
    gone.clear();
    off = undefined;
  } else if (key === HINTS_OFF) off = undefined;
  else if (!HINT_KEY.test(key)) return;
  else if (value === null) gone.delete(key);
  changed();
}

if (typeof window !== 'undefined') window.addEventListener('storage', (e) => heardStorage(e.key, e.newValue));

/** Whether first-time hints show at all ("Enable first-time hints", Settings → Hints). */
export function hintsOn() {
  if (off !== undefined) return !off;
  try {
    return localStorage.getItem(HINTS_OFF) !== '1';
  } catch {
    return true;
  }
}

/**
 * Turns every hint off or back on; off keeps which ones were dismissed, so on shows only the rest.
 * The page keeps the choice even where the browser's storage refuses it.
 */
export function setHintsOn(on: boolean) {
  off = !on;
  try {
    if (on) localStorage.removeItem(HINTS_OFF);
    else localStorage.setItem(HINTS_OFF, '1');
  } catch {}
  changed();
}

/** Whether first-time hints show, kept current as the setting changes. */
export function useHintsOn() {
  return useSyncExternalStore(subscribe, hintsOn, hintsOn);
}

/**
 * Whether the owner has used what the hint under `key` points to, or dismissed it, whatever the
 * toggle says. Code deciding whether to record a use (`know`) asks this, so a use while hints are
 * off still counts once they are back on.
 */
export function used(key: string) {
  if (gone.has(key)) return true;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Whether the hint under `key` is not to show: the owner has used what it points to, dismissed it, or turned hints off. */
export function known(key: string) {
  return !hintsOn() || used(key);
}

/** Remembers that the owner has used it: its hint goes, in this page even where the browser's storage refuses it. */
export function know(key: string) {
  gone.add(key);
  try {
    localStorage.setItem(key, '1');
  } catch {}
  changed();
}

/** Whether the hint under `key` has gone, kept current when it goes or every hint is reset. */
export function useKnown(key: string) {
  const read = () => known(key);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Brings every hint back ("Reset all hints", Settings → Hints); gives how many had gone. A hint is
 * known by its key `seismic-<name>-known` in this browser's local storage, so this removes every
 * key of that shape. Throws where the storage cannot be read or a key not removed, so the reset
 * never reports a success it did not have.
 */
export function forgetAllHints(store?: Storage) {
  const from = store ?? localStorage;
  const keys: string[] = [];
  for (let i = 0; i < from.length; i++) {
    const key = from.key(i);
    if (key && HINT_KEY.test(key)) keys.push(key);
  }
  for (const key of keys) from.removeItem(key);
  gone.clear();
  changed();
  if (keys.some((key) => from.getItem(key) !== null)) throw new Error('hints still stored');
  return keys.length;
}
