



import { useEffect, useSyncExternalStore } from 'react';

const PASTE_DUE = 'seismic-paste-hint';

let due: string | null = (() => {
  try {
    return localStorage.getItem(PASTE_DUE);
  } catch {
    return null;
  }
})();

let fields: string[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function setDue(key: string | null) {
  due = key;
  try {
    if (key) localStorage.setItem(PASTE_DUE, key);
    else localStorage.removeItem(PASTE_DUE);
  } catch {}
  changed();
}

/**
 * The field the hint shows in: the one it is due in, or, while that is gone (the card it was on
 * closed, say), the field that appeared last.
 */
export function hintField(due: string | null, fields: string[]): string | null {
  if (!due || !fields.length) return null;
  return fields.includes(due) ? due : fields[fields.length - 1]!;
}

/** Only where there is a keyboard to paste with: a phone has none to hint at. */
const hasKeyboard = () => typeof matchMedia === 'function' && matchMedia('(any-pointer: fine)').matches;

/** Screenshots picked from disk into field `key` arrived: the hint is due there. The caller checks that the hint still shows. */
export function pickedShots(key: string) {
  if (!hasKeyboard()) return;
  setDue(key);
}

/** The owner pasted a screenshot or confirmed the hint: it is no longer due anywhere. */
export function pastedShots() {
  if (due) setDue(null);
}

/** Whether the hint shows in field `key`, which takes screenshots while `on`. */
export function usePasteHint(key: string, on: boolean) {
  useEffect(() => {
    if (!on) return;
    fields = [...fields, key];
    changed();
    return () => {
      const i = fields.lastIndexOf(key);
      if (i >= 0) fields = fields.toSpliced(i, 1);
      changed();
    };
  }, [key, on]);
  return useSyncExternalStore(subscribe, () => on && hintField(due, fields) === key);
}
