import { basename } from 'node:path';
import type { RepoAdapter, RepoInfo } from './types';

/** Repository name from the `origin` URL, else the directory name. */
export function repoName(repo: RepoInfo): string {
  const fromRemote = repo.remote?.replace(/\.git$/, '').split(/[/:]/).pop();
  return fromRemote || basename(repo.path);
}


export const generic: RepoAdapter = {
  planDocs: { dir: 'docs/plan', exclude: ['TEMPLATE.md'] },
  language: 'en',
  land: 'pr',
  workstations: 'worktrees',
  softPaths: ['docs/plan/'],
};
