// Migration shim for the rename: what this browser keeps under names from before it (`obeya-…`,
// `obeya.…` in localStorage and sessionStorage) is moved to the `seismic-…` / `seismic.…` name once, at
// page start, before any of it is read. A value already under the new name stays; the old name is
// removed, so only the new one is written from then on. The drafts' own keys, `obeya` and
// `obeya:<project>` inside the stored drafts (draft.ts), are renamed where they are read.

/** `obeya-theme` as `seismic-theme`; null for a key that is not from before the rename. */
export const renamedKey = (key: string): string | null => (/^obeya[-.]/.test(key) ? `seismic${key.slice('obeya'.length)}` : null);

/** The draft key `obeya` or `obeya:<project>` as `seismic`, `seismic:<project>`; other keys as they are. */
export const renamedDraftKey = (key: string): string => (key === 'obeya' || key.startsWith('obeya:') ? `seismic${key.slice('obeya'.length)}` : key);

/** Moves the old names in `stores` to the new ones; returns how many keys moved. */
export function migrateBrowserState(stores: Storage[]): number {
  let moved = 0;
  for (const store of stores) {
    try {
      const old: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && renamedKey(key)) old.push(key);
      }
      for (const key of old) {
        const to = renamedKey(key)!;
        if (store.getItem(to) === null) store.setItem(to, store.getItem(key)!);
        store.removeItem(key);
        moved++;
      }
    } catch {
      // storage that is unavailable or full keeps what it has
    }
  }
  return moved;
}
