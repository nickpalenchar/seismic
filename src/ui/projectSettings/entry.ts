// A project's entry as its editor saves it: over the configuration as saved at that moment.

import type { ProjectConfig } from '../../core/types';

/** The project fields owned by the entry editor. */
const EDITED = ['name', 'id', 'oldNames', 'icon'] as const;

/**
 * The entry as edited, over `fresh`, the same entry as saved now: what the editor sets comes from the
 * draft. A repository that still has its saved path keeps its current settings and workstation
 * configuration. Choosing to keep a folder without git also drops its Git workstations.
 */
export function mergedEntry(draft: ProjectConfig, fresh: ProjectConfig): ProjectConfig {
  const next: ProjectConfig = { ...fresh, repos: [] };
  for (const k of EDITED) delete next[k];
  for (const k of EDITED) if (draft[k] !== undefined) Object.assign(next, { [k]: draft[k] });
  next.repos = draft.repos.map((r) => {
    const was = fresh.repos.find((f) => f.path.trim() === r.path.trim());
    if (!was) return r;
    if (r.git === was.git) return was;
    if (r.git === false) return { path: r.path, git: false, ...(was.settings ? { settings: was.settings } : {}) };
    const { git: _, ...rest } = was;
    return rest;
  });
  return next;
}

/** `projects` with `entry` in place of the project at `at`, or added to them for a new one. */
export const withEntry = (projects: ProjectConfig[], at: number, entry: ProjectConfig) => (at < projects.length ? projects.map((p, i) => (i === at ? entry : p)) : [...projects, entry]);

