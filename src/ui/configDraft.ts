



type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;


export type ConfigDraftName = 'demo' | `project:${string}`;

export const configDraftKey = (name: ConfigDraftName) => `seismic-config-draft-${name}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Writes down `draft` while it differs from what is saved (`saved`), else forgets it. */
export function keepConfigDraft<T>(store: Store, name: ConfigDraftName, draft: T, saved: unknown, pick: (d: T) => unknown = (d) => d) {
  try {
    if (same(pick(draft), saved)) store.removeItem(configDraftKey(name));
    else store.setItem(configDraftKey(name), JSON.stringify(draft));
  } catch {}
}

/** The draft written down, if it still differs from what is saved (`saved`). */
export function keptConfigDraft<T>(store: Store, name: ConfigDraftName, saved: unknown, pick: (d: T) => unknown = (d) => d): T | null {
  try {
    const raw = store.getItem(configDraftKey(name));
    const d = raw ? (JSON.parse(raw) as T) : null;
    return d && !same(pick(d), saved) ? d : null;
  } catch {
    return null;
  }
}
