














import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { adoptOldConfig, CONFIG_FILE } from '../src/server/config';
import { databaseFile, moveDefaultHome } from '../src/server/home-move';
import { ownerHeaders } from '../src/server/owner';
import { waitUp } from './wait-up';

const source = process.argv[2] ?? join(homedir(), existsSync(join(homedir(), '.seismic')) ? '.seismic' : '.obeya');
const home = mkdtempSync(join(tmpdir(), 'seismic-home-copy-'));
const failures: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};






const NOT_COPIED = new Set(['workspaces', 'read', 'voices', 'server.json', 'tailscale-serve.json']);
for (const f of readdirSync(source)) {
  if (/^(obeya|seismic)\.db/.test(f)) continue;
  if (!NOT_COPIED.has(f)) cpSync(join(source, f), join(home, f), { recursive: true });
}

const settingsFile = join(home, 'settings.json');
if (existsSync(settingsFile)) {
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
  delete settings.remote;
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
}
const sourceDatabase = databaseFile(source);
if (existsSync(sourceDatabase)) {
  const live = new Database(sourceDatabase, { readonly: true });
  live.run(`VACUUM INTO '${join(home, 'seismic.db').replaceAll("'", "''")}'`);
  live.close();
}
/** Every file under `dir`, relative, with its size. */
const listing = (dir: string) => (existsSync(dir) ? (readdirSync(dir, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[]).filter((e) => e.isFile()).map((e) => `${join(e.parentPath, e.name).slice(dir.length)}:${statSync(join(e.parentPath, e.name)).size}`).sort() : []);
const DIRS = readdirSync(home, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const filesBefore = Object.fromEntries(DIRS.map((d) => [d, listing(join(home, d))]));
adoptOldConfig(home);


const file = join(home, CONFIG_FILE);
type Repo = { path: string; [k: string]: unknown };
const config = JSON.parse(readFileSync(file, 'utf8')) as { repos: Repo[]; [k: string]: unknown }[];
let n = 0;
for (const p of config)
  for (const r of p.repos) {
    const real = r.path.replace(/^~/, homedir());
    
    const to = join(home, 'repos', String(n++), basename(real));
    mkdirSync(join(home, 'repos', String(n - 1)), { recursive: true });
    
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


const db = new Database(join(home, 'seismic.db'));
function tablesBefore() {
  return (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
}
const count = (sql: string) => (db.query(sql).get() as { n: number }).n;
const before = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
const leases = count('SELECT count(*) n FROM ' + (db.query("SELECT 1 FROM sqlite_master WHERE name = 'workstations'").get() ? 'workstations' : 'workspaces'));
const projectColumn = (db.query("SELECT 1 FROM pragma_table_info('cards') WHERE name = 'project_id'").get() ? 'project_id' : 'canvas_id');
const cardsBy = Object.fromEntries((db.query(`SELECT ${projectColumn} id, count(*) n FROM cards WHERE deleted_at IS NULL AND archived_at IS NULL GROUP BY ${projectColumn}`).all() as { id: string; n: number }[]).map((r) => [r.id, r.n]));



const moved = (col: string) => `replace(${col}, '${join(source, 'workspaces')}', '${join(home, 'workspaces')}')`;
for (const t of ['workstations', 'workspaces']) if (db.query('SELECT 1 FROM sqlite_master WHERE name = ?').get(t)) db.run(`UPDATE ${t} SET path = ${moved('path')}`);
for (const c of ['workstation', 'workspace']) if (db.query("SELECT 1 FROM pragma_table_info('cards') WHERE name = ?").get(c)) db.run(`UPDATE cards SET ${c} = ${moved(c)} WHERE ${c} IS NOT NULL`);


const RENAMED: Record<string, string> = tablesBefore().includes('projects') ? { workspaces: 'workstations' } : { canvases: 'projects', workspaces: 'workstations' };
const tables = tablesBefore();
const rowsBefore = Object.fromEntries(tables.map((t) => [RENAMED[t] ?? t, count(`SELECT count(*) n FROM "${t}"`)]));
const openIds = (db.query(`SELECT ${projectColumn} p, id FROM cards WHERE deleted_at IS NULL AND archived_at IS NULL`).all() as { p: string; id: string }[]).reduce<Record<string, string[]>>((m, r) => ((m[r.p] ??= []).push(r.id), m), {});
const shots = (db.query("SELECT images FROM events WHERE images IS NOT NULL AND images != '[]'").all() as { images: string }[]).flatMap((r) => JSON.parse(r.images) as string[]);
db.close();
console.log(`home copy ${home}: schema ${before}, ${Object.values(cardsBy).reduce((a, b) => a + b, 0)} cards on the projects, ${leases} workstation leases kept (checkouts not copied), ${shots.length} screenshots referred to`);



{
  const user = mkdtempSync(join(tmpdir(), 'seismic-home-move-'));
  const old = join(user, '.obeya');
  cpSync(home, old, { recursive: true });
  renameSync(join(old, 'seismic.db'), join(old, 'obeya.db'));
  const repo = config[0]?.repos.find((r) => r.git !== false && existsSync(join(r.path, '.git')))?.path;
  const checkout = join(old, 'workspaces', 'move-check', 'w1');
  if (repo) spawnSync('git', ['-C', repo, 'worktree', 'add', '--quiet', '-b', 'move-check', checkout]);
  const there = new Database(join(old, 'obeya.db'));
  for (const t of ['workstations', 'workspaces']) if (there.query('SELECT 1 FROM sqlite_master WHERE name = ?').get(t)) there.run(`UPDATE ${t} SET path = replace(path, '${join(home, 'workspaces')}', '${join(old, 'workspaces')}')`);
  for (const c of ['workstation', 'workspace']) if (there.query("SELECT 1 FROM pragma_table_info('cards') WHERE name = ?").get(c)) there.run(`UPDATE cards SET ${c} = replace(${c}, '${join(home, 'workspaces')}', '${join(old, 'workspaces')}') WHERE ${c} IS NOT NULL`);
  const inOld = (db: Database) =>
    ['workstations', 'workspaces'].flatMap((t) => (db.query('SELECT 1 FROM sqlite_master WHERE name = ?').get(t) ? (db.query(`SELECT path p FROM ${t}`).all() as { p: string }[]).map((r) => r.p) : [])).filter((p) => p.startsWith(old));
  const leasesBefore = inOld(there).length;
  there.close();
  const jsonBefore = readdirSync(old).filter((f) => f.endsWith('.json') && readFileSync(join(old, f), 'utf8').includes(old));
  const moved = await moveDefaultHome({ user, claudeDir: join(user, '.claude') });
  const now = join(user, '.seismic');
  expect(moved.moved && moved.problems.length === 0, `the home moves to ~/.seismic${moved.problems.length ? `: ${moved.problems.join('; ')}` : ''}`);
  expect(lstatSync(old).isSymbolicLink() && existsSync(join(now, 'seismic.db')) && !existsSync(join(now, 'obeya.db')), '~/.obeya is a link to it, and the database is seismic.db');
  if (repo) {
    const list = spawnSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout;
    const nowCheckout = join(now, 'workspaces', 'move-check', 'w1');
    expect(list.includes(`worktree ${realpathSync(nowCheckout)}`) && spawnSync('git', ['-C', nowCheckout, 'status'], { encoding: 'utf8' }).status === 0, 'the repository\'s worktree link follows the move (git worktree repair)');
  }
  const moveCheck = new Database(join(now, 'seismic.db'), { readonly: true });
  const leftBehind = ['workstations', 'workspaces'].some((t) => moveCheck.query('SELECT 1 FROM sqlite_master WHERE name = ?').get(t) && (moveCheck.query(`SELECT count(*) n FROM ${t} WHERE path LIKE ?`).get(`${old}%`) as { n: number }).n > 0);
  const rewritten = (moveCheck.query("SELECT count(*) n FROM sqlite_master WHERE name IN ('workstations', 'workspaces')").get() as { n: number }).n ? inOld(moveCheck).length : 0;
  moveCheck.close();
  expect(!leftBehind && rewritten === 0, `no lease keeps the old home's path (${leasesBefore} leases named it before)`);
  expect(jsonBefore.every((f) => !readFileSync(join(now, f), 'utf8').includes(old)), `the home paths in ${jsonBefore.join(', ') || 'no JSON file'} are rewritten`);
  rmSync(user, { recursive: true, force: true });
}


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
    
    const lostFiles = DIRS.flatMap((d) => {
      const now = new Set(listing(join(home, d)));
      return filesBefore[d]!.filter((f) => !now.has(f)).map((f) => `${d}${f}`);
    });
    expect(lostFiles.length === 0, `no file of ${DIRS.join(', ')} was lost (${Object.values(filesBefore).flat().length} files)${lostFiles.length ? `: ${lostFiles.slice(0, 5).join(', ')}` : ''}`);
  }
  const check = new Database(join(home, 'seismic.db'), { readonly: true });
  const after = (check.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  
  const layer = /^(canvases|canvases_name|cards_canvas|sqlite_autoindex_canvases_1)$/;
  const left = (check.query('SELECT name, sql FROM sqlite_master').all() as { name: string; sql: string | null }[]).filter(
    (o) => !layer.test(o.name) && /canvas/i.test(o.name + (o.sql ?? '').replace(/,\s*`?canvas_id`? text/i, '')),
  );
  const hadCanvases = tables.includes('canvases') && tables.includes('projects');
  if (!hadCanvases && check.query("SELECT 1 FROM sqlite_master WHERE name = 'canvases'").get()) {
    const mains = check.query("SELECT project_id p, id FROM canvases WHERE name = 'main'").all() as { p: string; id: string }[];
    const projectsInDb = (check.query('SELECT id FROM projects').all() as { id: string }[]).map((r) => r.id);
    expect(projectsInDb.every((p) => mains.filter((m) => m.p === p).length === 1), `every project of the database has one canvas "main" (${projectsInDb.length} projects)`);
    const off = (t: string) => (check.query(`SELECT count(*) n FROM ${t} x WHERE canvas_id IS NULL OR canvas_id != (SELECT id FROM canvases c WHERE c.project_id = x.project_id AND c.name = 'main')`).get() as { n: number }).n;
    expect(off('cards') === 0 && off('groups') === 0, `every card and group is on its project's "main" (${off('cards')} cards, ${off('groups')} groups elsewhere)`);
  }
  expect(after > before || before === after, `schema ${before} -> ${after}`);
  const rowsAfter = Object.fromEntries(Object.keys(rowsBefore).map((t) => [t, (check.query(`SELECT count(*) n FROM "${t}"`).get() as { n: number }).n]));
  
  
  const gone = Object.keys(rowsBefore).filter((t) => t !== 'workstations' && rowsAfter[t]! < rowsBefore[t]!);
  expect(gone.length === 0, `no table lost rows in the migration (${Object.keys(rowsBefore).length} tables, ${Object.values(rowsBefore).reduce((a, b) => a + b, 0)} rows before; workstation leases ${rowsBefore.workstations} -> ${rowsAfter.workstations}${gone.map((t) => `; ${t}: ${rowsBefore[t]} -> ${rowsAfter[t]}`).join('')})`);
  expect(!!check.query("SELECT 1 FROM sqlite_master WHERE name = 'canvases'").get(), 'the canvas layer is there');
  expect(left.length === 0, `no name with "canvas" is left in the schema but the canvas layer's${left.length ? `: ${left.map((o) => o.name).join(', ')}` : ''}`);
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
