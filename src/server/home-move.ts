














import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { running } from './instance';

export const HOME_MOVE_MARKER = '.home-move-pending';
export const DATABASE = 'seismic.db';

export const OLD_DATABASE = 'obeya.db';

/** The database of a home: `seismic.db`, else `obeya.db` where a home (a custom one, say) still has only that. */
export function databaseFile(home: string): string {
  if (!existsSync(join(home, DATABASE)) && existsSync(join(home, OLD_DATABASE))) return join(home, OLD_DATABASE);
  return join(home, DATABASE);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with the path `from` (as a prefix of a longer path or on its own, in plain or JSON-escaped
 * form) named `to`, and `~/.obeya` as `~/.seismic` when the home is the default one.
 */
export function rewritePaths(text: string, from: string, to: string): string {
  const forms: [string, string][] = [[from, to], [JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1)]];
  let out = text;
  for (const [a, b] of forms) out = out.replace(new RegExp(`${escapeRe(a)}(?![\\w.-])`, 'g'), () => b);
  return out;
}

/** `/Users/me/.obeya/workspaces/x` as Claude Code names its folder under `projects/`. */
export const claudeFolderName = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

export interface HomeMoveResult {
  
  home: string;
  moved: boolean;
  
  skipped?: string;
  repaired: string[];
  rewrittenFiles: string[];
  rewrittenRows: number;
  claudeFolders: string[];
  problems: string[];
}

export interface HomeMoveOptions {
  
  user?: string;
  
  dev?: boolean;
  
  claudeDir?: string;
}

const isRealDirectory = (p: string) => {
  try {
    const s = lstatSync(p);
    return s.isDirectory() && !s.isSymbolicLink();
  } catch {
    return false;
  }
};
const exists = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * The default home to use, moved from the old one first where that applies: the new one is not there,
 * the old one is a real folder (not a symlink) and no Seismic runs on it. Never throws: where it cannot
 * move, the old home stays in use.
 */
export async function moveDefaultHome(options: HomeMoveOptions = {}): Promise<HomeMoveResult> {
  const user = options.user ?? homedir();
  const suffix = options.dev ? '-dev' : '';
  const from = join(user, `.obeya${suffix}`);
  const to = join(user, `.seismic${suffix}`);
  const result: HomeMoveResult = { home: to, moved: false, repaired: [], rewrittenFiles: [], rewrittenRows: 0, claudeFolders: [], problems: [] };
  const claudeDir = options.claudeDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(user, '.claude');
  try {
    if (exists(to)) {
      
      if (existsSync(join(to, HOME_MOVE_MARKER))) finish(from, to, claudeDir, result);
      return result;
    }
    if (!isRealDirectory(from)) return result;
    const other = await running(from);
    if (other) {
      result.home = from;
      result.skipped = `a Seismic runs on it (pid ${other.pid}, ${other.url})`;
      return result;
    }
    renameSync(from, to);
    writeFileSync(join(to, HOME_MOVE_MARKER), `${JSON.stringify({ from, to })}\n`);
    for (const suffix of ['', '-wal', '-shm']) if (exists(join(to, OLD_DATABASE + suffix))) renameSync(join(to, OLD_DATABASE + suffix), join(to, DATABASE + suffix));
    result.moved = true;
    try {
      symlinkSync(options.dev ? `.seismic-dev` : '.seismic', from, process.platform === 'win32' ? 'junction' : undefined);
    } catch (e) {
      result.problems.push(`the symlink ${from} -> ${to} could not be made: ${(e as Error).message}`);
    }
    finish(from, to, claudeDir, result);
  } catch (e) {
    
    if (!exists(to)) result.home = exists(from) ? from : to;
    result.skipped = (e as Error).message;
  }
  return result;
}

/** Steps 3 to 5, each safe to run again; then the marker goes. */
function finish(from: string, to: string, claudeDir: string, result: HomeMoveResult) {
  const attempt = (what: string, f: () => void) => {
    try {
      f();
    } catch (e) {
      result.problems.push(`${what}: ${(e as Error).message}`);
    }
  };
  attempt('git worktree repair', () => (result.repaired = repairCheckouts(to)));
  attempt('database paths', () => (result.rewrittenRows = rewriteDatabase(to, from, to)));
  attempt('JSON files', () => (result.rewrittenFiles = rewriteJsonFiles(to, from, to)));
  attempt('Claude Code sessions', () => (result.claudeFolders = renameClaudeFolders(claudeDir, from, to)));
  if (!result.problems.length) rmSync(join(to, HOME_MOVE_MARKER), { force: true });
}

/** Every checkout under `workspaces/<project>/<id>` and `read/<project>/<name>` of `home`. */
export function checkouts(home: string): string[] {
  const dirs = (p: string) => {
    try {
      return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(p, e.name));
    } catch {
      return [];
    }
  };
  return ['workspaces', 'read'].flatMap((top) => dirs(join(home, top)).flatMap(dirs)).filter((d) => existsSync(join(d, '.git')));
}

/** `git worktree repair` from inside each checkout: the repository's link to it is renewed. Returns the checkouts repaired. */
function repairCheckouts(home: string): string[] {
  const done: string[] = [];
  for (const dir of checkouts(home)) {
    
    if (!lstatSync(join(dir, '.git')).isFile()) continue;
    const r = spawnSync('git', ['-C', dir, 'worktree', 'repair'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) done.push(dir);
    else throw new Error(`${dir}: ${(r.stderr || r.error?.message || '').trim()}`);
  }
  return done;
}

/** The paths of the leases `workstations.path` and `cards.workstation` (`workspaces` and `workspace` before their rename) that lay in the old home. Returns rows changed. */
function rewriteDatabase(home: string, from: string, to: string): number {
  const file = databaseFile(home);
  if (!existsSync(file)) return 0;
  const db = new Database(file);
  try {
    let n = 0;
    const has = (t: string, c: string) => !!db.query('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(t, c);
    for (const [table, column] of [['workstations', 'path'], ['workspaces', 'path'], ['cards', 'workstation'], ['cards', 'workspace']] as const) {
      if (!has(table, column)) continue;
      const col = `"${column}"`;
      const r = db.query(`UPDATE "${table}" SET ${col} = ?1 || substr(${col}, length(?2) + 1) WHERE substr(${col}, 1, length(?2)) = ?2 AND (length(${col}) = length(?2) OR substr(${col}, length(?2) + 1, 1) IN ('/', '\\'))`).run(to, from);
      n += r.changes;
    }
    return n;
  } finally {
    db.close();
  }
}

/** The JSON files at the top of the home and in `sessions/`, their absolute home paths renamed. Returns the files changed. */
function rewriteJsonFiles(home: string, from: string, to: string): string[] {
  const files = [home, join(home, 'sessions')].flatMap((dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(dir, e.name));
    } catch {
      return [];
    }
  });
  const changed: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    let out = rewritePaths(text, from, to);
    
    if (from.endsWith('.obeya') || from.endsWith('.obeya-dev')) out = out.replace(/~\/\.obeya(-dev)?(?![\w.-])/g, (_, dev) => `~/.seismic${dev ?? ''}`);
    if (out === text) continue;
    writeFileSync(f, out);
    changed.push(f);
  }
  return changed;
}

/** The folders Claude Code keeps sessions in for the moved checkouts, renamed to the name of their new path. Returns the new names. */
function renameClaudeFolders(claudeDir: string, from: string, to: string): string[] {
  const root = join(claudeDir, 'projects');
  if (!existsSync(root)) return [];
  const renamed: string[] = [];
  for (const top of ['workspaces', 'read']) {
    const oldPrefix = claudeFolderName(join(from, top)) + '-';
    const newPrefix = claudeFolderName(join(to, top)) + '-';
    for (const name of readdirSync(root)) {
      if (!name.startsWith(oldPrefix)) continue;
      const target = newPrefix + name.slice(oldPrefix.length);
      
      if (existsSync(join(root, target))) continue;
      renameSync(join(root, name), join(root, target));
      renamed.push(target);
    }
  }
  return renamed;
}

/** What the start says after a move. */
export function moveNotice(r: HomeMoveResult, from: string): string {
  return `Seismic: moved ${from} to ${r.home} (${r.repaired.length} checkouts repaired, ${r.rewrittenRows} database rows and ${r.rewrittenFiles.length} files rewritten, ${r.claudeFolders.length} Claude Code session folders renamed); ${from} is now a link to it. A checkout from before the rename that is started now finds no database there and shows an empty setup: start Seismic from the current code.`;
}
