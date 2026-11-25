

import { useCallback, useEffect, useState } from 'react';
import { type InboxEntry, readMark } from '../core/inbox';

const READ = 'seismic-inbox-read';

const KEEP = 500;

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(READ) ?? '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** The read marks, kept across reloads and in step with the browser's other tabs. */
export function useInboxRead(): { isRead: (e: InboxEntry) => boolean; read: (mark: string) => boolean; markRead: (e: InboxEntry) => void } {
  const [marks, setMarks] = useState(() => new Set(load()));
  useEffect(() => {
    const other = (ev: StorageEvent) => ev.key === READ && setMarks(new Set(load()));
    addEventListener('storage', other);
    return () => removeEventListener('storage', other);
  }, []);
  const markRead = useCallback((e: InboxEntry) => {
    const mark = readMark(e);
    const kept = load();
    if (kept.at(-1) === mark) return;
    
    const list = [...kept.filter((x) => x !== mark), mark].slice(-KEEP);
    try {
      localStorage.setItem(READ, JSON.stringify(list));
    } catch {}
    setMarks(new Set(list));
  }, []);
  const read = useCallback((mark: string) => marks.has(mark), [marks]);
  const isRead = useCallback((e: InboxEntry) => marks.has(readMark(e)), [marks]);
  return { isRead, read, markRead };
}
