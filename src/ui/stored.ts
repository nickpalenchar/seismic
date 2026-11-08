// State this browser keeps across reloads: a value in localStorage under a key, often one per project.

import { useMemo, useState } from 'react';

/** The value under `key`, `fallback` while there is none; a new key (another project) reads its own. */
export function useStoredState<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [set, setSet] = useState<{ key: string; v: T } | null>(null);
  const v = useMemo(() => {
    if (set?.key === key) return set.v;
    try {
      return (JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback) as T;
    } catch {
      return fallback;
    }
  }, [set, key]);
  return [
    v,
    (next) => {
      setSet({ key, v: next });
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
    },
  ];
}
