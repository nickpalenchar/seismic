// Drafts must remain available to the restart snapshot even when a browser store is full.
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

export const draftSession = {
  getItem(key: string): string | null {
    const entries = overflow();
    if (entries.has(key)) return entries.get(key) ?? null;
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string) {
    const entries = overflow();
    try {
      sessionStorage.setItem(key, value);
      entries.delete(key);
    } catch {
      entries.set(key, value);
    }
  },
  removeItem(key: string) {
    const entries = overflow();
    try {
      sessionStorage.removeItem(key);
      entries.delete(key);
    } catch {
      entries.set(key, null);
    }
  },
};

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
