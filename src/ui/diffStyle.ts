// How a diff lays out its lines: side by side (`split`) or one under the other (`unified`). The
// owner's choice is kept in this browser for every card; the phone view shows unified only.

import { useSyncExternalStore } from 'react';
import { phoneView } from './phoneEnvironment';

export type DiffStyle = 'split' | 'unified';

const KEY = 'seismic-diff-style';
const listeners = new Set<() => void>();

const read = (): DiffStyle => {
  try {
    return localStorage.getItem(KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    removeEventListener('storage', listener);
  };
}

/** The layout diffs show in, and a setter; `choosable` is false where only unified is offered (the phone). */
export function useDiffStyle(): { style: DiffStyle; set: (s: DiffStyle) => void; choosable: boolean } {
  const chosen = useSyncExternalStore(subscribe, read);
  const choosable = !phoneView();
  return {
    style: choosable ? chosen : 'unified',
    choosable,
    set: (s) => {
      try {
        localStorage.setItem(KEY, s);
      } catch {}
      listeners.forEach((l) => l());
    },
  };
}
