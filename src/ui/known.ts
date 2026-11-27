import { useSyncExternalStore } from 'react';

const HINT_KEY = /^seismic-.+-known$/;

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Whether the owner has used what the hint under `key` points to. */
export function known(key: string) {
  try {
    return localStorage.getItem(key) === '1';
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
