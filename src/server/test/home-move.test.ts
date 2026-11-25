import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generic } from '../../adapters/generic';
import { Board } from '../board';
import { claim } from '../instance';
import { claudeFolderName, databaseFile, HOME_MOVE_MARKER, moveDefaultHome, rewritePaths } from '../home-move';
import { Store } from '../store';
import { FakeRuntime, gitRepo } from './helpers/testing';
import { WorkerSupervisor } from '../workerSupervisor/workerSupervisor';
import { git, Workstations } from '../workstations';

let user: string;
let claudeDir: string;
beforeEach(() => {
  
  user = realpathSync(mkdtempSync(join(tmpdir(), 'seismic-home-move-')));
  claudeDir = join(user, '.claude');
});
afterEach(() => rmSync(user, { recursive: true, force: true }));

const home = (dev = false) => join(user, dev ? '.obeya-dev' : '.obeya');
const moved = (dev = false) => join(user, dev ? '.seismic-dev' : '.seismic');

/** An old home with a database, JSON files and a session entry that name its own path. */
function oldHome(dev = false) {
  const h = home(dev);
  mkdirSync(join(h, 'sessions'), { recursive: true });
  const db = new Database(join(h, 'obeya.db'));
  db.run('PRAGMA journal_mode = WAL');
  db.run('CREATE TABLE workstations (path TEXT PRIMARY KEY, card_id TEXT)');
  db.run('CREATE TABLE cards (id TEXT PRIMARY KEY, workstation TEXT, body TEXT)');
  db.run('INSERT INTO workstations VALUES (?, ?)', [`${h}/workspaces/shop/a1`, 'a']);
  db.run('INSERT INTO workstations VALUES (?, ?)', [`/elsewhere/workspaces/shop/a2`, 'b']);
  db.run('INSERT INTO cards VALUES (?, ?, ?)', ['a', `${h}/workspaces/shop/a1`, `see ${h}/x`]);
  db.run('INSERT INTO cards VALUES (?, ?, ?)', ['b', `${h}-dev/workspaces/shop/a1`, null]);
  db.close();
  writeFileSync(join(h, 'projects.json'), JSON.stringify([{ name: 'Shop', repos: [{ path: '/repos/shop', workstations: [`${h}/workspaces/shop/a1`] }, { path: '~/.obeya/read/shop' }] }], null, 2));
  writeFileSync(join(h, 'sessions', 's1.json'), JSON.stringify({ generation: 's1', cwd: `${h}/workspaces/shop/a1`, label: 'Claude' }));
  writeFileSync(join(h, 'owner.key'), 'secret\n');
  return h;
}

test('rewritePaths renames the home as a path, plain or JSON-escaped, never a longer name that starts like it', () => {
  expect(rewritePaths('/u/.obeya/x and /u/.obeya', '/u/.obeya', '/u/.seismic')).toBe('/u/.seismic/x and /u/.seismic');
  expect(rewritePaths('/u/.obeya-dev/x /u/.obeyabc', '/u/.obeya', '/u/.seismic')).toBe('/u/.obeya-dev/x /u/.obeyabc');
  expect(rewritePaths('"C:\\\\u\\\\.obeya\\\\x"', 'C:\\u\\.obeya', 'C:\\u\\.seismic')).toBe('"C:\\\\u\\\\.seismic\\\\x"');
});

test('the home moves in one rename: its database files, the link back, the paths it holds, the Claude Code session folders', async () => {
  const h = oldHome();
  const db = new Database(join(h, 'obeya.db'));
  db.run('UPDATE cards SET body = ? WHERE id = ?', ['later', 'b']);
  db.close();
  
  const folders = join(claudeDir, 'projects');
  const old = claudeFolderName(join(h, 'workspaces', 'shop', 'a1'));
  mkdirSync(join(folders, old), { recursive: true });
  writeFileSync(join(folders, old, 's.jsonl'), '{}\n');
  mkdirSync(join(folders, claudeFolderName(join(h, 'read', 'shop', 'repo'))), { recursive: true });
  mkdirSync(join(folders, claudeFolderName(join(h, 'workspaces', 'shop', 'a1')).replace('obeya', 'obeya-dev')), { recursive: true });
  mkdirSync(join(folders, '-Users-me-code-app'), { recursive: true });

  const r = await moveDefaultHome({ user, claudeDir });
  expect(r).toMatchObject({ home: moved(), moved: true, problems: [] });
  expect(lstatSync(home()).isSymbolicLink()).toBe(true);
  expect(readlinkSync(home())).toBe('.seismic');
  expect(existsSync(join(moved(), 'obeya.db'))).toBe(false);
  expect(databaseFile(moved())).toBe(join(moved(), 'seismic.db'));
  expect(readFileSync(join(home(), 'owner.key'), 'utf8')).toBe('secret\n');
  expect(existsSync(join(moved(), HOME_MOVE_MARKER))).toBe(false);

  const after = new Database(join(moved(), 'seismic.db'), { readonly: true });
  expect(after.query('SELECT path FROM workstations ORDER BY card_id').all()).toEqual([{ path: `${moved()}/workspaces/shop/a1` }, { path: '/elsewhere/workspaces/shop/a2' }]);
  
  expect(after.query('SELECT id, workstation, body FROM cards ORDER BY id').all()).toEqual([
    { id: 'a', workstation: `${moved()}/workspaces/shop/a1`, body: `see ${home()}/x` },
    { id: 'b', workstation: `${home()}-dev/workspaces/shop/a1`, body: 'later' },
  ]);
  after.close();
  const config = JSON.parse(readFileSync(join(moved(), 'projects.json'), 'utf8'));
  expect(config[0].repos[0].workstations).toEqual([`${moved()}/workspaces/shop/a1`]);
  expect(config[0].repos[1].path).toBe('~/.seismic/read/shop');
  expect(JSON.parse(readFileSync(join(moved(), 'sessions', 's1.json'), 'utf8')).cwd).toBe(`${moved()}/workspaces/shop/a1`);
  expect(r.claudeFolders.sort()).toEqual([claudeFolderName(join(moved(), 'read', 'shop', 'repo')), claudeFolderName(join(moved(), 'workspaces', 'shop', 'a1'))].sort());
  expect(existsSync(join(folders, old))).toBe(false);
  expect(existsSync(join(folders, claudeFolderName(join(moved(), 'workspaces', 'shop', 'a1')), 's.jsonl'))).toBe(true);
  expect(existsSync(join(folders, '-Users-me-code-app'))).toBe(true);
  
  expect(existsSync(join(folders, claudeFolderName(join(h, 'workspaces', 'shop', 'a1')).replace('obeya', 'obeya-dev')))).toBe(true);
});

test('the dev home moves to ~/.seismic-dev, and a second start leaves what moved alone', async () => {
  oldHome(true);
  const r = await moveDefaultHome({ user, claudeDir, dev: true });
  expect(r).toMatchObject({ home: moved(true), moved: true });
  expect(readlinkSync(home(true))).toBe('.seismic-dev');
  expect(await moveDefaultHome({ user, claudeDir, dev: true })).toMatchObject({ home: moved(true), moved: false, problems: [] });
});

test('nothing moves where the new home is there already, the old one is a link, or there is none', async () => {
  mkdirSync(moved(), { recursive: true });
  mkdirSync(home(), { recursive: true });
  writeFileSync(join(home(), 'obeya.db'), '');
  expect(await moveDefaultHome({ user, claudeDir })).toMatchObject({ home: moved(), moved: false });
  expect(existsSync(join(home(), 'obeya.db'))).toBe(true);

  rmSync(user, { recursive: true, force: true });
  mkdirSync(join(user, 'elsewhere'), { recursive: true });
  symlinkSync(join(user, 'elsewhere'), home());
  expect(await moveDefaultHome({ user, claudeDir })).toMatchObject({ home: moved(), moved: false });
  expect(lstatSync(home()).isSymbolicLink()).toBe(true);
  expect(existsSync(moved())).toBe(false);

  rmSync(home());
  expect(await moveDefaultHome({ user, claudeDir })).toMatchObject({ home: moved(), moved: false });
});

test('a Seismic that runs on the old home keeps it where it is', async () => {
  const h = oldHome();
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json([]) });
  const other = Bun.spawn(['sleep', '30']);
  try {
    claim(h, { pid: other.pid, port: server.port!, url: `http://127.0.0.1:${server.port}`, version: '0' });
    const r = await moveDefaultHome({ user, claudeDir });
    expect(r).toMatchObject({ home: h, moved: false, skipped: expect.stringContaining('runs') });
    expect(existsSync(join(h, 'obeya.db'))).toBe(true);
    expect(existsSync(moved())).toBe(false);
  } finally {
    other.kill();
    server.stop(true);
  }
});

test('steps that did not finish are done by the next start, which reads the marker', async () => {
  const h = oldHome();
  const r = await moveDefaultHome({ user, claudeDir });
  expect(r.moved).toBe(true);
  
  const db = new Database(join(moved(), 'seismic.db'));
  db.run('UPDATE cards SET workstation = ? WHERE id = ?', [`${h}/workspaces/shop/a1`, 'a']);
  db.close();
  writeFileSync(join(moved(), HOME_MOVE_MARKER), '{}\n');
  expect(await moveDefaultHome({ user, claudeDir })).toMatchObject({ home: moved(), moved: false, rewrittenRows: 1 });
  expect(existsSync(join(moved(), HOME_MOVE_MARKER))).toBe(false);
});

test("a worktree of a project's repository follows the move, and a paused worker resumes its session in it", async () => {
  const h = home();
  const repo = join(user, 'shop');
  gitRepo(repo);
  mkdirSync(h, { recursive: true });
  
  const build = (path: string, dir: string) => {
    const store = new Store(path);
    const board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: repo, branch: 'main' }] }, () => ({ docs: [], dirs: [] }), undefined, () => true, () => 'en', () => 'en');
    const runtime = new FakeRuntime();
    const spaces = new Workstations(store, 'c', { mode: 'worktrees', repoPath: repo, dir });
    const workers = new WorkerSupervisor({ board, runtime, workstations: spaces, adapter: { ...generic, land: 'main', workstations: 'worktrees' } });
    return { store, board, runtime, workers };
  };
  let cardId: string;
  let was: string;
  {
    const before = build(join(user, 'build.db'), join(h, 'workspaces', 'shop'));
    using db = before.store.db;
    try {
      cardId = before.board.create({ title: 'Export readings', x: 0, y: 0 }).id;
      await before.workers.start(cardId);
      before.runtime.last.emit({ type: 'session', id: 'sess-1' });
      was = before.board.row(cardId).workstation!;
      expect(was.startsWith(`${h}/workspaces/shop/`)).toBe(true);
    } finally {
      before.workers.shutdown();
      await before.workers.freed();
    }
    
    db.run('VACUUM INTO ?', [join(h, 'obeya.db')]);
  }
  mkdirSync(join(claudeDir, 'projects', claudeFolderName(was)), { recursive: true });

  const r = await moveDefaultHome({ user, claudeDir });
  expect(r).toMatchObject({ home: moved(), moved: true, problems: [] });
  const now = was.replace(h, moved());
  expect(r.repaired).toContain(now);
  
  expect(readFileSync(join(repo, '.git', 'worktrees', now.split('/').at(-1)!, 'gitdir'), 'utf8').trim()).toBe(`${now}/.git`);
  expect(git(now, 'rev-parse', '--show-toplevel')).toBe(now);
  expect(git(repo, 'worktree', 'list', '--porcelain')).toContain(`worktree ${now}`);
  expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(`worktree ${was}\n`);
  expect(existsSync(join(claudeDir, 'projects', claudeFolderName(now)))).toBe(true);

  
  const after = build(databaseFile(moved()), join(moved(), 'workspaces', 'shop'));
  using _db = after.store.db;
  try {
    after.workers.resumeAll();
    expect(after.board.row(cardId).workstation).toBe(now);
    expect(after.runtime.last.spec.cwd).toBe(now);
    expect(after.runtime.last.spec.resume).toBe('sess-1');
  } finally {
    
    after.workers.shutdown();
    await after.workers.freed();
  }
});
