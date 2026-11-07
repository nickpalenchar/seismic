// What the owner changed in the configuration's dialog but has not saved yet (the canvases with
// their repositories, the demo settings), written down per tab as it changes, so that it outlives
// closing the dialog and a page load: Seismic's restart, say, which reloads the page mid-edit.

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The dialog's drafts that are saved with a button of their own. */
export type ConfigDraftName = 'canvases' | 'demo';

const key = (name: ConfigDraftName) => `obeya-config-draft-${name}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Writes down `draft` while it differs from what is saved (`saved`), else forgets it. */
export function keepConfigDraft<T>(store: Store, name: ConfigDraftName, draft: T, saved: unknown, pick: (d: T) => unknown = (d) => d) {
  try {
    if (same(pick(draft), saved)) store.removeItem(key(name));
    else store.setItem(key(name), JSON.stringify(draft));
  } catch {}
}

/** The draft written down, if it still differs from what is saved (`saved`). */
export function keptConfigDraft<T>(store: Store, name: ConfigDraftName, saved: unknown, pick: (d: T) => unknown = (d) => d): T | null {
  try {
    const raw = store.getItem(key(name));
    const d = raw ? (JSON.parse(raw) as T) : null;
    return d && !same(pick(d), saved) ? d : null;
  } catch {
    return null;
  }
}
