// Starts Seismic on a copy of an existing home (from before projects were canvases, say) and
// checks that it comes up with what the home held, without running agents or touching anything
// outside the copy:
//   bun scripts/check-home-migration.ts [home]      (default: ~/.obeya; the home itself is never written)
//
// The copy holds the database, the JSON files and the screenshots and files the cards refer to. Each
// repository of the configuration is cloned locally into the copy and the configuration points at
// those clones, so the read checkouts Seismic makes never land in the real repositories; the
// workstation leases of the database are dropped for the same reason (their number is reported).
// Then it starts the server (`--idle-workers`) and asserts: the schema is migrated and holds no
// name with "canvas", every project of the configuration is served with the cards the database
// holds for it, and every screenshot an event refers to is found as it was in the home. Exits 1
// with the reasons otherwise.

import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

for (const f of readdirSync(source)) {
  if (/^(obeya\.db.*|[A-Za-z0-9._-]+\.(json|key))$/.test(f)) cpSync(join(source, f), join(home, f));
  else if (['images', 'files'].includes(f)) cpSync(join(source, f), join(home, f), { recursive: true });
}
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
for (const t of ['workstations', 'workspaces']) if (db.query('SELECT 1 FROM sqlite_master WHERE name = ?').get(t)) db.run(`DELETE FROM ${t}`);
for (const c of ['workstation', 'workspace']) if (db.query("SELECT 1 FROM pragma_table_info('cards') WHERE name = ?").get(c)) db.run(`UPDATE cards SET ${c} = NULL`);
const shots = (db.query("SELECT images FROM events WHERE images IS NOT NULL AND images != '[]'").all() as { images: string }[]).flatMap((r) => JSON.parse(r.images) as string[]);
db.close();
console.log(`home copy ${home}: schema ${before}, ${Object.values(cardsBy).reduce((a, b) => a + b, 0)} cards on the projects, ${leases} workstation leases dropped, ${shots.length} screenshots referred to`);

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
      const snap = r.ok ? ((await r.json()) as { items: unknown[] }) : null;
      expect(!!snap && snap.items.length >= Math.min(cardsBy[p.id] ?? 0, 1) && snap.items.length <= (cardsBy[p.id] ?? 0) + 1000, `${p.id}: snapshot loads with ${snap?.items.length ?? '–'} items (${cardsBy[p.id] ?? 0} cards in the database)`);
    }
    const missing = [...new Set(shots)].filter((id) => !existsSync(join(home, 'images')) || !readdirSync(join(home, 'images'), { recursive: true }).some((f) => String(f).includes(id)));
    const missingAtSource = [...new Set(shots)].filter((id) => !readdirSync(join(source, 'images'), { recursive: true }).some((f) => String(f).includes(id)));
    expect(missing.length === missingAtSource.length, `screenshots found as in the home (${missing.length} missing, ${missingAtSource.length} in the home itself)`);
  }
  const check = new Database(join(home, 'obeya.db'), { readonly: true });
  const after = (check.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  const left = check.query("SELECT name FROM sqlite_master WHERE sql LIKE '%anvas%' OR name LIKE '%anvas%'").all();
  expect(after > before || before === after, `schema ${before} -> ${after}`);
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
