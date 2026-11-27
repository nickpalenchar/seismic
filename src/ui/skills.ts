




import { useEffect, useSyncExternalStore } from 'react';
import type { Skill } from '../core/types';
import { api } from './api';


const FRESH_MS = 60_000;


const lists = new Map<string, { skills?: Skill[]; at: number }>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function ask(cardId: string) {
  const kept = lists.get(cardId);
  if (kept && Date.now() - kept.at < FRESH_MS) return;
  lists.set(cardId, { skills: kept?.skills, at: Date.now() });
  api
    .skills(cardId)
    .then((skills) => lists.set(cardId, { skills, at: Date.now() }))
    
    .catch(() => lists.set(cardId, { skills: kept?.skills ?? [], at: 0 }))
    .finally(changed);
}

const NONE: Skill[] = [];

/** The skills of the card's agent (undefined while they are asked); none without a card. Asks again when `fresh` changes. */
export function useSkills(cardId: string | undefined, fresh?: unknown): Skill[] | undefined {
  useEffect(() => {
    if (cardId) ask(cardId);
  }, [cardId, fresh]);
  return useSyncExternalStore(subscribe, () => (cardId ? lists.get(cardId)?.skills : NONE));
}


export interface Slash {
  start: number;
  query: string;
}

/** The `/` word ending at `caret`, at the start of the text or after a space; a path (`/a/b`) is none. */
export function slashAt(text: string, caret: number): Slash | null {
  const m = /(?:^|\s)\/([^\s/]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]! };
}

/**
 * The skills that fit `query`, case aside: those whose name, or its part after a plugin's prefix
 * (`seismic:demo`), starts with it first, then those that contain it; each group as listed.
 */
export function matching(skills: Skill[], query: string): Skill[] {
  const q = query.toLowerCase();
  const starts = (s: Skill) => {
    const name = s.name.toLowerCase();
    return name.startsWith(q) || name.slice(name.indexOf(':') + 1).startsWith(q);
  };
  const first = skills.filter(starts);
  return [...first, ...skills.filter((s) => !first.includes(s) && s.name.toLowerCase().includes(q))];
}

/**
 * What picking a skill types over the `/` word (from its slash to the cursor): its name and a space,
 * or none where a space follows already, which the cursor then steps over (`skip`).
 */
export function skillWord(text: string, slash: Slash, caret: number, name: string): { from: number; to: number; word: string; skip: number } {
  const spaced = text.slice(caret).startsWith(' ');
  return { from: slash.start, to: caret, word: `/${name}${spaced ? '' : ' '}`, skip: spaced ? 1 : 0 };
}
