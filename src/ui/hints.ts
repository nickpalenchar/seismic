import { createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type HintId, isHintId } from '../registries/hintRegistry';
import { getSeenHints, markHintSeen, resetHints } from './clients/seismic';

const HINTS_OFF = 'seismic-hints-off';

const LEGACY_KEY = /^seismic-(.+)-known$/;

type Seen = ReadonlySet<HintId> | null;

/**
 * Loads which hints the owner has seen, once per page load and before the first paint. Resolves to
 * `null` when the server cannot say. Hints an older version of the page remembered in local storage
 * count as seen at once and are sent to the server in the background; their local key goes when it
 * has them.
 */
export async function loadSeenHints(): Promise<Seen> {
  let ids: string[];
  try {
    ids = await getSeenHints();
  } catch (error) {
    console.error('Seismic: the seen hints could not be loaded; no hint shows', error);
    return null;
  }
  const seen = new Set(ids.filter(isHintId));
  for (const { key, id } of legacyHints()) {
    const sent = seen.has(id);
    seen.add(id);
    void (sent ? Promise.resolve() : markHintSeen(id)).then(() => localStorage.removeItem(key), () => {});
  }
  return seen;
}

/** The hints local storage still holds from before the server did. */
function legacyHints(): { key: string; id: HintId }[] {
  try {
    return Object.keys(localStorage).flatMap((key) => {
      const id = LEGACY_KEY.exec(key)?.[1];
      return id && isHintId(id) && localStorage.getItem(key) === '1' ? [{ key, id }] : [];
    });
  } catch {
    return [];
  }
}

const readEnabled = () => {
  try {
    return localStorage.getItem(HINTS_OFF) !== '1';
  } catch {
    return true;
  }
};

export interface HintsValue {
  shown: (id: HintId) => boolean;
  seen: (id: HintId) => boolean;
  markSeen: (id: HintId) => void;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  reset: () => Promise<void>;
}

const UNAVAILABLE: HintsValue = { shown: () => false, seen: () => true, markSeen: () => {}, enabled: true, setEnabled: () => {}, reset: () => Promise.resolve() };

const HintsContext = createContext<HintsValue>(UNAVAILABLE);

/**
 * Holds the hints seen (from `loadSeenHints`) for the page below it, as React state shared by
 * context. What it offers: `shown(id)`, whether the hint shows (hints are on, it has not been seen,
 * and the seen hints could be loaded); `seen(id)`, whether the owner has used what it points to or
 * dismissed it whatever the toggle says (code deciding whether to record a use asks this; where
 * the seen hints could not be loaded every hint counts as seen, so nothing is recorded either);
 * `markSeen(id)`, at once in the page and then on the server; `enabled` and `setEnabled`, "Enable
 * first-time hints" in Settings → Hints (off hides every hint without touching which were seen,
 * and stays in this browser's local storage); and `reset()`, "Reset all hints", which rejects when
 * the server could not. Outside a provider no hint shows and none is recorded.
 */
export function HintsProvider({ initial, children }: { initial: Seen; children: ReactNode }) {
  const [seen, setSeen] = useState(initial);
  const latest = useRef(seen);
  const [enabled, setEnabledState] = useState(readEnabled);

  useEffect(() => {
    const heard = (e: StorageEvent) => {
      if (e.key === null || e.key === HINTS_OFF) setEnabledState(readEnabled());
    };
    window.addEventListener('storage', heard);
    return () => window.removeEventListener('storage', heard);
  }, []);

  const markSeen = useCallback((id: HintId) => {
    const current = latest.current;
    if (!current || current.has(id)) return;
    const next = new Set(current).add(id);
    latest.current = next;
    setSeen(next);
    markHintSeen(id).catch((error) => console.error(`Seismic: the hint "${id}" could not be saved as seen`, error));
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      if (on) localStorage.removeItem(HINTS_OFF);
      else localStorage.setItem(HINTS_OFF, '1');
    } catch {}
  }, []);

  const reset = useCallback(async () => {
    await resetHints();
    latest.current = new Set();
    setSeen(latest.current);
  }, []);

  const value = useMemo<HintsValue>(
    () => ({ shown: (id) => enabled && !!seen && !seen.has(id), seen: (id) => !seen || seen.has(id), markSeen, enabled, setEnabled, reset }),
    [seen, enabled, markSeen, setEnabled, reset],
  );
  return createElement(HintsContext, { value }, children);
}

export const useHints = () => useContext(HintsContext);

/** One hint: whether it shows, and the way to record its use or dismissal. */
export function useHint(id: HintId) {
  const { shown, seen, markSeen } = useHints();
  return { shown: shown(id), seen: seen(id), markSeen: () => markSeen(id) };
}
