

import type { ProjectConfig, RepoConfig } from '../../core/types';

export type DraftRepo = RepoConfig & { originalPath: string | null };
export type EntryDraft = Omit<ProjectConfig, 'repos'> & { repos: DraftRepo[] };

/** Start a draft, or restore the identities stored with an earlier edit. */
export function entryDraft(entry: ProjectConfig, saved: ProjectConfig | null = entry): EntryDraft {
  return {
    ...entry,
    repos: entry.repos.map((repo: RepoConfig & Partial<Pick<DraftRepo, 'originalPath'>>) => {
      if (repo.originalPath !== undefined) return { ...repo, originalPath: repo.originalPath };
      const original = saved?.repos.find((r) => r.path.trim() === repo.path.trim());
      if (original) return { ...repo, originalPath: original.path };
      
      const { path, git } = repo;
      return { path, ...(git === false ? { git } : {}), originalPath: null };
    }),
  };
}


const EDITED = ['name', 'id', 'oldNames', 'icon'] as const;

/**
 * The entry as edited, over `fresh`, the same entry as saved now: what the editor sets comes from the
 * draft. The original path identifies a repository even if its new path is already in use by
 * another draft row. Choosing to keep a folder without git also drops its Git workstations.
 */
export function mergedEntry(draft: EntryDraft, fresh?: ProjectConfig): ProjectConfig {
  if (!fresh) return { ...draft, repos: draft.repos.map(({ originalPath: _, ...repo }) => repo) };
  const next: ProjectConfig = { ...fresh, repos: [] };
  for (const k of EDITED) delete next[k];
  for (const k of EDITED) if (draft[k] !== undefined) Object.assign(next, { [k]: draft[k] });
  next.repos = draft.repos.map(({ originalPath, ...repo }) => {
    if (originalPath === null) return repo;
    const was = fresh.repos.find((r) => r.path.trim() === originalPath.trim());
    const { path, git } = repo;
    if (!was || (git === false && was.git !== false)) {
      return { path, ...(git === false ? { git } : {}), ...(was?.settings ? { settings: was.settings } : {}) };
    }
    const { git: _, ...rest } = was;
    return git === false ? { ...rest, path, git } : { ...rest, path };
  });
  return next;
}

/** `projects` with `entry` in place of the project at `at`, or added to them for a new one. */
export const withEntry = (projects: ProjectConfig[], at: number, entry: ProjectConfig) => (at < projects.length ? projects.map((p, i) => (i === at ? entry : p)) : [...projects, entry]);

