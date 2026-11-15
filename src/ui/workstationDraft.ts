import type { RepoConfig } from '../core/types';

// UI-only draft data travels with the entry through immutable edits and view remounts.
// A symbol is copied by object spread, but never goes into the JSON save payload.
const parkedClones = Symbol('parkedClones');
type CloneFields = Pick<RepoConfig, 'clones' | 'workstations' | 'hosts'>;
type Draft = RepoConfig & { [parkedClones]?: CloneFields };

export function parkClones(repo: RepoConfig): RepoConfig {
  const { clones, workstations, hosts, ...rest } = repo;
  return { ...rest, [parkedClones]: { clones, workstations, hosts } } as Draft;
}

export function restoreClones(repo: RepoConfig): RepoConfig {
  const { [parkedClones]: parked, ...rest } = repo as Draft;
  return { ...rest, ...parked };
}
