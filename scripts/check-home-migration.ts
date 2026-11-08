// Starts Seismic on a copy of an existing home (from before projects were canvases, say) and
// checks that it comes up with what the home held, without running agents or touching anything
// outside the copy:
//   bun scripts/check-home-migration.ts [home]      (default: ~/.obeya; the home itself is never written)
//
// The copy holds the database (a SQLite snapshot), the JSON and key files and every directory of files the home
// keeps but the checkouts. Each git repository of the configuration is cloned locally into the copy and the configuration points at
// those clones (a folder without git is copied), so the read checkouts Seismic makes never land in the real repositories; the
// workstation leases of the database stay, with their paths moved into the copy (the checkouts are not).
// Then it starts the server (`--idle-workers`) and asserts: the schema is migrated and holds no
// name with "canvas", every project of the configuration is served with the cards the database
// holds for it, no table lost a row, and every screenshot an event refers to is found as it was in the home. Exits 1
// with the reasons otherwise.

import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { adoptOldConfig, CONFIG_FILE } from '../src/server/config';
import { ownerHeaders } from '../src/server/owner';
import { waitUp } from './wait-up';

const source = process.argv[2] ?? join(homedir(), '.obeya');
const home = mkdtempSync(join(tmpdir(), 'obeya-home-copy-'));
const failures: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

// Everything the home persists but the checkouts (`workspaces/`, `read/`: gigabytes, and worktrees
// that point back into the real repositories) and the voice models. The database goes through
// SQLite's own snapshot, since a running Seismic writes to it while it is copied.
const NOT_COPIED = new Set(['workspaces', 'read', 'voices']);
for (const f of readdirSync(source)) {
  if (/^obeya\.db/.test(f)) continue;
  if (!NOT_COPIED.has(f)) cpSync(join(source, f), join(home, f), { recursive: true });
}
if (existsSync(join(source, 'obeya.db'))) {
  const live = new Database(join(source, 'obeya.db'), { readonly: true });
  live.run(`VACUUM INTO '${join(home, 'obeya.db').replaceAll("'", "''")}'`);
  live.close();
}
/** Every file under `dir`, relative, with its size. */
const listing = (dir: string) => (existsSync(dir) ? (readdirSync(dir, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[]).filter((e) => e.isFile()).map((e) => `${join(e.parentPath, e.name).slice(dir.length)}:${statSync(join(e.parentPath, e.name)).size}`).sort() : []);
const DIRS = readdirSync(home, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const filesBefore = Object.fromEntries(DIRS.map((d) => [d, listing(join(home, d))]));
adoptOldConfig(home);

// repositories: local clones inside the copy
const file = join(home, CONFIG_FILE);
type Repo = { path: string; [k: string]: unknown };
const config = JSON.parse(readFileSync(file, 'utf8')) as { repos: Repo[]; [k: string]: unknown }[];
let n = 0;
for (const p of config)
  for (const r of p.repos) {
    const real = r.path.replace(/^~/, homedir());
    // the folder keeps its name: a project's home repository is named by it
    const to = join(home, 'repos', String(n++), basename(real));
    mkdirSync(join(home, 'repos', String(n - 1)), { recursive: true });
    // a folder without git is copied as it is
    if (r.git === false) {
      if (existsSync(real)) cpSync(real, to, { recursive: true });
      else mkdirSync(to, { recursive: true });
      r.path = to;
      delete r.workstations;
      delete r.hosts;
      continue;
    }
    const cloned = existsSync(real) && spawnSync('git', ['clone', '--quiet', '--local', real, to]).status === 0;
    if (!cloned) mkdirSync(to, { recursive: true });
    else {
      // the clone has the remotes the repository has (a repository is named by them), not the original as origin
      const git = (...a: string[]) => spawnSync('git', ['-C', to, ...a], { encoding: 'utf8' });
      const remotes = spawnSync('git', ['-C', real, 'remote'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
      git('remote', 'remove', 'origin');
      for (const name of remotes) git('remote', 'add', name, spawnSync('git', ['-C', real, 'remote', 'get-url', name], { encoding: 'utf8' }).stdout.trim());
    }
    r.path = to;
    delete r.workstations;
    delete r.hosts;
  }
writeFileSync(file, JSON.stringify(config, null, 2));

// the database: what it holds before, and no workstation leases
const db = new Database(join(home, 'obeya.db'));
const count = (sql: string) => (db.query(sql).get() as { n: number }).n;
const before = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
const leases = count('SELECT count(*) n FROM ' + (db.query("SELECT 1 FROM sqlite_master WHERE name = 'workstations'").get() ? 'workstations' : 'workspaces'));
const projectColumn = (db.query("SELECT 1 FROM pragma_table_info('cards') WHERE name = 'project_id'").get() ? 'project_id' : 'canvas_id');
const cardsBy = Object.fromEntries((db.query(`SELECT ${projectColumn} id, count(*) n FROM cards WHERE deleted_at IS NULL AND archived_at IS NULL GROUP BY ${projectColumn}`).all() as { id: string; n: number }[]).map((r) => [r.id, r.n]));
// The leases stay, with their paths moved into the copy, where the checkouts are not (copying them
// would copy gigabytes and git worktrees that point back into the real repositories): the cards
// that were at work come up with their workstation gone, which is what the server has to cope with.
const moved = (col: string) => `replace(${col}, '${join(source, 'workspaces')}', '${join(home, 'workspaces')}')`;
for (const t of ['workstations', 'workspaces']) if (db.query('SELECT 1 FROM sqlite_master WHERE name = ?').get(t)) db.run(`UPDATE ${t} SET path = ${moved('path')}`);
for (const c of ['workstation', 'workspace']) if (db.query("SELECT 1 FROM pragma_table_info('cards') WHERE name = ?").get(c)) db.run(`UPDATE cards SET ${c} = ${moved(c)} WHERE ${c} IS NOT NULL`);
// every row of every table, to compare after the migration (a table renamed since keeps its count)
const RENAMED: Record<string, string> = { canvases: 'projects', workspaces: 'workstations' };
const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
const rowsBefore = Object.fromEntries(tables.map((t) => [RENAMED[t] ?? t, count(`SELECT count(*) n FROM "${t}"`)]));
const openIds = (db.query(`SELECT ${projectColumn} p, id FROM cards WHERE deleted_at IS NULL AND archived_at IS NULL`).all() as { p: string; id: string }[]).reduce<Record<string, string[]>>((m, r) => ((m[r.p] ??= []).push(r.id), m), {});
const shots = (db.query("SELECT images FROM events WHERE images IS NOT NULL AND images != '[]'").all() as { images: string }[]).flatMap((r) => JSON.parse(r.images) as string[]);
db.close();
console.log(`home copy ${home}: schema ${before}, ${Object.values(cardsBy).reduce((a, b) => a + b, 0)} cards on the projects, ${leases} workstation leases kept (checkouts not copied), ${shots.length} screenshots referred to`);

// the server
const port = await new Promise<number>((res) => {
  const s = createServer().listen(0, () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => res(p));
  });
});
const log = join(home, 'server.log');
const out = openSync(log, 'w');
const server = spawn(process.execPath, ['src/server/main.ts', '--config', file, '--port', String(port), '--dev', '--idle-workers'], {
  cwd: join(import.meta.dir, '..'),
  env: { ...process.env, SEISMIC_HOME: home },
  stdio: ['ignore', out, out],
});
let exited: number | null = null;
server.on('exit', (c) => (exited = c ?? -1));
const base = `http://127.0.0.1:${port}`;
const owner = ownerHeaders(home);
try {
  const up = await waitUp(`${base}/api/projects`, { headers: owner, exited: () => exited, limit: 3 * 60_000 });
  expect(up.up, 'the server comes up on the copy');
  if (up.up) {
    const projects = (await (await fetch(`${base}/api/projects`, { headers: owner })).json()) as { id: string; name: string }[];
    expect(projects.length === config.length, `all ${config.length} projects of ${CONFIG_FILE} are served (${projects.map((p) => p.id).join(', ')})`);
    for (const p of projects) {
      const r = await fetch(`${base}/api/c/${encodeURIComponent(p.id)}/project`, { headers: owner });
      const snap = r.ok ? ((await r.json()) as { items: { id: string }[] }) : null;
      const shown = new Set((snap?.items ?? []).map((i) => i.id));
      const lost = (openIds[p.id] ?? []).filter((id) => !shown.has(id));
      expect(!!snap && lost.length === 0, `${p.id}: the snapshot shows all ${(openIds[p.id] ?? []).length} open cards of the database${lost.length ? `; missing ${lost.join(', ')}` : ''}`);
    }
    const found = (root: string, id: string) => existsSync(root) && readdirSync(root, { recursive: true }).some((f) => String(f).includes(id));
    const missing = [...new Set(shots)].filter((id) => !found(join(home, 'images'), id));
    const missingAtSource = new Set([...new Set(shots)].filter((id) => !found(join(source, 'images'), id)));
    expect(missing.every((id) => missingAtSource.has(id)), `every screenshot the home has is found (${shots.length} referred to; ${missingAtSource.size} already missing in the home itself: ${[...missingAtSource].join(', ') || 'none'})`);
    // and what the server does to the files it keeps: none goes
    const lostFiles = DIRS.flatMap((d) => {
      const now = new Set(listing(join(home, d)));
      return filesBefore[d]!.filter((f) => !now.has(f)).map((f) => `${d}${f}`);
    });
    expect(lostFiles.length === 0, `no file of ${DIRS.join(', ')} was lost (${Object.values(filesBefore).flat().length} files)${lostFiles.length ? `: ${lostFiles.slice(0, 5).join(', ')}` : ''}`);
  }
  const check = new Database(join(home, 'obeya.db'), { readonly: true });
  const after = (check.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  const left = check.query("SELECT name FROM sqlite_master WHERE sql LIKE '%anvas%' OR name LIKE '%anvas%'").all();
  expect(after > before || before === after, `schema ${before} -> ${after}`);
  const rowsAfter = Object.fromEntries(Object.keys(rowsBefore).map((t) => [t, (check.query(`SELECT count(*) n FROM "${t}"`).get() as { n: number }).n]));
  // the server may add rows while it starts (chats, a project row); none of the home's may go
  // (the leases are the exception: the server forgets those whose checkout is not there, as in the copy)
  const gone = Object.keys(rowsBefore).filter((t) => t !== 'workstations' && rowsAfter[t]! < rowsBefore[t]!);
  expect(gone.length === 0, `no table lost rows in the migration (${Object.keys(rowsBefore).length} tables, ${Object.values(rowsBefore).reduce((a, b) => a + b, 0)} rows before; workstation leases ${rowsBefore.workstations} -> ${rowsAfter.workstations}${gone.map((t) => `; ${t}: ${rowsBefore[t]} -> ${rowsAfter[t]}`).join('')})`);
  expect(left.length === 0, 'no name with "canvas" is left in the schema');
  expect(check.query('PRAGMA foreign_key_check').all().length === 0, 'no foreign key is violated');
  check.close();
  expect(!/\b(Error|error:)/.test(readFileSync(log, 'utf8').replace(/\x1b\[[0-9;]*m/g, '')), `the server log has no error (${log})`);
} finally {
  server.kill();
  if (!failures.length) rmSync(home, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
