





import { existsSync, mkdirSync, realpathSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { BadRequest } from './board';
import { setUpGit } from './git-setup';
import { expandHome } from '../../plugin/skills/demo/lib/settings.ts';
import { GIT } from './workstations';
import type { Messages } from '../core/messages';

type Words = Messages['newRepo'];

export interface MadeRepo {
  
  path: string;
  
  made: boolean;
  
  undo: () => void;
}

/** The folder a new repository's path names, absolute; refused where it is none Seismic could make one in. */
export function newRepoPath(path: string, t: Words): string {
  const p = path.trim();
  if (!p) throw new BadRequest('newRepoPath', t.noPath);
  if (!folderPath(p)) throw new BadRequest('newRepoPath', `${p}: an absolute path, or one from ~`);
  return resolve(expandHome(p));
}

/** Whether `p` names a folder on its own: absolute on this system, or from the home (`~`, `~/…`). */
export const folderPath = (p: string) => p === '~' || p.startsWith('~/') || (process.platform === 'win32' && p.startsWith('~\\')) || isAbsolute(p);

/** A path as the file system resolves it (links followed); as given where it does not exist. */
export function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync([GIT, ...args], { cwd, env: process.env, stderr: 'pipe' });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
};

/**
 * Makes the folder at `path` (absolute) a repository: created where it is missing, git set up where
 * it has none. A folder inside another repository is refused, since git there would find that one.
 */
export function makeRepo(path: string, t: Words): MadeRepo {
  const existed = existsSync(path);
  if (existed && !statSync(path).isDirectory()) throw new BadRequest('newRepoPath', t.notFolder(path));
  if (existed) {
    const top = git(path, 'rev-parse', '--show-toplevel');
    
    if (top && realpathSync(top) === realpathSync(path)) return { path, made: false, undo: () => {} };
    if (top) throw new BadRequest('newRepoPath', t.inside(path, top));
  } else {
    
    let up = dirname(path);
    while (!existsSync(up) && dirname(up) !== up) up = dirname(up);
    const top = existsSync(up) && statSync(up).isDirectory() ? git(up, 'rev-parse', '--show-toplevel') : null;
    if (top) throw new BadRequest('newRepoPath', t.inside(path, top));
  }
  
  let created: string | null = null;
  if (!existed) {
    let top = path;
    while (!existsSync(dirname(top)) && dirname(top) !== top) top = dirname(top);
    mkdirSync(path, { recursive: true });
    created = top;
  }
  const gitignore = `${path}/.gitignore`;
  const hadIgnore = existsSync(gitignore);
  
  const removeCreated = () => {
    rmSync(path, { recursive: true, force: true });
    for (let up = dirname(path); created && up.length >= created.length; up = dirname(up)) {
      try {
        rmdirSync(up);
      } catch {
        break;
      }
    }
  };
  const undo = () => {
    if (created) return removeCreated();
    rmSync(`${path}/.git`, { recursive: true, force: true });
    if (!hadIgnore) rmSync(gitignore, { force: true });
  };
  try {
    setUpGit(path);
  } catch (e) {
    if (created) removeCreated();
    throw e;
  }
  return { path, made: true, undo };
}
