import { useSyncExternalStore } from 'react';

const HINT_KEY = /^seismic-.+-known$/;

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const HINTS_OFF = 'seismic-hints-off';

/** Whether first-time hints show at all ("Enable first-time hints", Settings → Hints). */
export function hintsOn() {
  try {
    return localStorage.getItem(HINTS_OFF) !== '1';
  } catch {
    return true;
  }
}

/** Turns every hint off or back on; off keeps which ones were dismissed, so on shows only the rest. */
export function setHintsOn(on: boolean) {
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

/** Whether the hint under `key` is not to show: the owner has used what it points to, dismissed it, or turned hints off. */
export function known(key: string) {
  try {
    return !hintsOn() || localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Remembers that the owner has used it: its hint goes. */
export function know(key: string) {
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
 * Brings every hint back ("Reset all hints", Settings → Advanced); gives how many had gone. A hint
 * is known by its key `seismic-<name>-known` in this browser's local storage, so this removes every
 * key of that shape.
 */
export function forgetAllHints(store: Storage = localStorage) {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && HINT_KEY.test(key)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {}
  changed();
  return keys.length;
}
