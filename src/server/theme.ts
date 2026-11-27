






import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_DIR, REPO_DIRS } from '../adapters';
import { themeData } from './artifactCopy';
import { demoFile } from './demoFile';
import { GIT, isFolder } from './workstations';


export const THEME_DIR = REPO_DIR;
export const THEME_FILE = 'theme.css';


export interface Theme {
  css: string;
  hash: string;
}


const read = new Map<string, Theme | null>();

/**
 * The theme of the repository at `repo`: from the git tree of `.seismic/` on its default branch
 * (`tree`, as `readShared` notes it; none where it has none), or from a folder without git as the
 * folder has it. Null without a `theme.css`. The server waits for git here; `readingTheme` does not.
 */
export function readTheme(repo: string, tree: string | undefined): Theme | null {
  if (isFolder(repo)) return themeOf(folderFiles(join(repo, REPO_DIRS.find((d) => existsSync(join(repo, d))) ?? THEME_DIR)));
  if (!tree) return null;
  const key = `${repo}\0${tree}`;
  if (!read.has(key)) read.set(key, themeOf(treeFiles(repo, tree)));
  return read.get(key)!;
}

/**
 * `readTheme` without the server waiting for git: the theme is put together again with each batch
 * of the files it names read, until it names none it lacks (a stylesheet it imports names more).
 */
export async function readingTheme(repo: string, tree: string | undefined): Promise<Theme | null> {
  if (isFolder(repo) || !tree) return readTheme(repo, tree);
  const key = `${repo}\0${tree}`;
  if (read.has(key)) return read.get(key)!;
  const blobs = blobsOf(await output([GIT, '-C', repo, 'ls-tree', '-r', '-z', tree]));
  const got = new Map<string, Buffer | null>();
  for (;;) {
    const lacking = new Set<string>();
    const theme = themeOf((path) => (got.has(path) ? got.get(path)! : (lacking.add(path), null)));
    if (!lacking.size) {
      read.set(key, theme);
      return theme;
    }
    const paths = [...lacking];
    const ids = paths.map((p) => blobs.get(p));
    const contents = await batch(repo, ids.filter((id): id is string => !!id));
    paths.forEach((p, i) => got.set(p, ids[i] ? (contents.get(ids[i]!) ?? null) : null));
  }
}

/** The theme from the files of `.seismic/`, each read by its path there; null without a `theme.css`. */
function themeOf(file: (path: string) => Buffer | null): Theme | null {
  const text = file(THEME_FILE);
  if (!text) return null;
  
  const css = themeData(text.toString('utf8'), join('/', THEME_DIR), file);
  return { css, hash: createHash('sha256').update(css).digest('hex').slice(0, 16) };
}

/** The regular files of a git tree, by their paths in it; a link (mode 120000) or a submodule is none. */
function treeFiles(repo: string, tree: string): (path: string) => Buffer | null {
  const r = Bun.spawnSync([GIT, '-C', repo, 'ls-tree', '-r', '-z', tree], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
  const blobs = blobsOf(r.exitCode === 0 ? r.stdout.toString() : '');
  return (path) => {
    const id = blobs.get(path);
    if (!id) return null;
    const b = Bun.spawnSync([GIT, '-C', repo, 'cat-file', 'blob', id], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    return b.exitCode === 0 ? Buffer.from(b.stdout) : null;
  };
}

/** The blobs of `ls-tree -r -z` output by their paths, regular files only. */
function blobsOf(listed: string): Map<string, string> {
  const blobs = new Map<string, string>();
  for (const e of listed.split('\0')) {
    const m = /^(100644|100755) blob (\S+)\t(.+)$/s.exec(e);
    if (m) blobs.set(m[3]!, m[2]!);
  }
  return blobs;
}

/** What a program printed, as text; empty where it failed. */
async function output(argv: string[]): Promise<string> {
  const p = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 ? out : '';
}

/** The contents of blobs, by their ids, read by one `git cat-file --batch`; one it cannot read is missing. */
async function batch(repo: string, ids: string[]): Promise<Map<string, Buffer>> {
  const got = new Map<string, Buffer>();
  if (!ids.length) return got;
  const p = Bun.spawn([GIT, '-C', repo, 'cat-file', '--batch'], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
  p.stdin.write(ids.map((id) => `${id}\n`).join(''));
  await p.stdin.end();
  const out = Buffer.from(await new Response(p.stdout).arrayBuffer());
  await p.exited;
  
  for (let at = 0; at < out.length; ) {
    const eol = out.indexOf(10, at);
    if (eol < 0) break;
    const [id, type, size] = out.subarray(at, eol).toString().split(' ');
    at = eol + 1;
    if (type !== 'blob' || size === undefined) continue;
    const n = Number(size);
    got.set(id!, Buffer.from(out.subarray(at, at + n)));
    at += n + 1;
  }
  return got;
}

/** The files of a folder's `.seismic/`, each where its real path lies inside it (`demoFile`). */
function folderFiles(dir: string): (path: string) => Buffer | null {
  return (path) => {
    const f = demoFile(dir, path);
    return f ? readFileSync(f) : null;
  };
}
