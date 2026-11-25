
const overflows = new WeakMap<Storage, Map<string, string | null>>();
const unavailable = new Map<string, string | null>();
const overflow = () => {
  try {
    let entries = overflows.get(sessionStorage);
    if (!entries) overflows.set(sessionStorage, (entries = new Map()));
    return entries;
  } catch {
    return unavailable;
  }
};

export const isDraftSessionKey = (key: string) => /^seismic-(drafts|markups|setting-draft|kept|wish|config-draft)-/.test(key);

const handoverListeners = new Set<(keys: ReadonlySet<string>) => void | Promise<void>>();
const pendingHandovers = new Set<Set<string>>();

/** Called after all missing entries from the previous page are available in this one. */
export function onHandOverEntries(fn: (keys: ReadonlySet<string>) => void | Promise<void>): () => void {
  handoverListeners.add(fn);
  return () => handoverListeners.delete(fn);
}

export const draftSession = {
  getItem(key: string): string | null {
    const entries = overflow();
    if (entries.has(key)) return entries.get(key) ?? null;
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string) {
    for (const keys of pendingHandovers) keys.add(key);
    const entries = overflow();
    try {
      sessionStorage.setItem(key, value);
      entries.delete(key);
    } catch {
      entries.set(key, value);
    }
  },
  removeItem(key: string) {
    if (pendingHandovers.size && draftSession.getItem(key) !== null)
      for (const keys of pendingHandovers) keys.add(key);
    const entries = overflow();
    try {
      sessionStorage.removeItem(key);
      entries.delete(key);
    } catch {
      entries.set(key, null);
    }
  },
};

/** A late reply fills missing entries, including in stores that have already opened them. */
export function prepareSessionHandOver(restored?: ReadonlySet<string>) {
  
  const occupied = new Set([...sessionWithDrafts().map(([key]) => key), ...(restored ?? [])]);
  pendingHandovers.add(occupied);
  return {
    async apply(entries: [string, string][]) {
      const added = new Set<string>();
      for (const [key, value] of entries) {
        if (occupied.has(key)) continue;
        if (isDraftSessionKey(key)) {
          if (draftSession.getItem(key) !== null) continue;
          draftSession.setItem(key, value);
        } else {
          try {
            if (sessionStorage.getItem(key) !== null) continue;
            sessionStorage.setItem(key, value);
          } catch { continue; }
        }
        added.add(key);
      }
      if (added.size) await Promise.all([...handoverListeners].map((fn) => fn(added)));
    },
    close: () => pendingHandovers.delete(occupied),
  };
}

/** The desktop bootstrap can deliver drafts that do not fit in this webview's session store. */
export function restoreDraftOverflow(entries: [string, string][]) {
  for (const [key, value] of entries) overflow().set(key, value);
}

export function sessionWithDrafts(): [string, string][] {
  const entries = new Map<string, string>();
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!;
      entries.set(key, sessionStorage.getItem(key) ?? '');
    }
  } catch {}
  for (const [key, value] of overflow()) {
    if (value === null) entries.delete(key);
    else entries.set(key, value);
  }
  return [...entries];
}
