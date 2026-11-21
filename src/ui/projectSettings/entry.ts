// A project's entry as its editor saves it: over the configuration as saved at that moment.

import type { ProjectConfig } from '../../core/types';

/** What the entry's editor sets: its name and the like, and its repositories; the rest of the entry (its settings) is the sheet's other sections'. */
const EDITED = ['name', 'id', 'oldNames', 'icon'] as const;

/**
 * The entry as edited, over `fresh`, the same entry as saved now: what the editor sets comes from the
 * draft, what else the entry holds (the project's settings, each repository's) from `fresh`. The
 * sheet's other sections save as they are changed, so what they saved since the draft was begun stays.
 */
export function mergedEntry(draft: ProjectConfig, fresh: ProjectConfig): ProjectConfig {
  const next: ProjectConfig = { ...fresh, repos: [] };
  for (const k of EDITED) delete next[k];
  for (const k of EDITED) if (draft[k] !== undefined) Object.assign(next, { [k]: draft[k] });
  next.repos = draft.repos.map((r) => {
    const was = fresh.repos.find((f) => f.path === r.path);
    if (!was) return r;
    const { settings: _, ...rest } = r;
    return was.settings ? { ...rest, settings: was.settings } : rest;
  });
  return next;
}

/** `projects` with `entry` in place of the project at `at`, or added to them for a new one. */
export const withEntry = (projects: ProjectConfig[], at: number, entry: ProjectConfig) => (at < projects.length ? projects.map((p, i) => (i === at ? entry : p)) : [...projects, entry]);

