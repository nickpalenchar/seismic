
















import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Tailscale } from '../src/server/tailscale';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const has = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args.splice(i, 1).length > 0;
};
const port = Number(flag('--port') ?? 4983);
const live = has('--live');
const local = has('--local');
const db = resolve(args[0] ?? join(process.env.SEISMIC_HOME ?? join(homedir(), '.seismic'), 'seismic.db'));
if (!existsSync(db)) fail(`no database at ${db}`);

const cache = join(process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? homedir()) : (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')), 'seismic-studio');
mkdirSync(cache, { recursive: true });


const version = (pkg: string) => (JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')) as { version: string }).version;
const wanted = { name: 'seismic-studio', private: true, dependencies: { 'drizzle-kit': version('drizzle-kit'), 'drizzle-orm': version('drizzle-orm'), 'better-sqlite3': '^12' } };
const manifest = join(cache, 'package.json');
const installed = existsSync(manifest) && existsSync(join(cache, 'node_modules', 'better-sqlite3')) ? readFileSync(manifest, 'utf8') : '';
if (installed !== JSON.stringify(wanted, null, 2)) {
  if (!Bun.which('node') || !Bun.which('npm')) fail('Drizzle Studio runs under Node: install Node.js (with npm) first');
  console.log(`Installing drizzle-kit ${wanted.dependencies['drizzle-kit']} with better-sqlite3 in ${cache} (once)…`);
  writeFileSync(manifest, JSON.stringify(wanted, null, 2));
  const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: cache, stdio: 'inherit', shell: process.platform === 'win32' });
  if (npm.status) {
    rmSync(manifest, { force: true });
    fail('npm install failed');
  }
}

let file = db;
if (!live) {
  file = join(cache, 'seismic-copy.db');
  for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
  const source = new Database(db, { readonly: true });
  source.run('VACUUM INTO ?', [file]);
  source.close();
}
const config = join(cache, 'drizzle.config.mjs');
writeFileSync(config, `export default ${JSON.stringify({ dialect: 'sqlite', dbCredentials: { url: file } })};\n`);

const studio = spawn('node', [join(cache, 'node_modules', 'drizzle-kit', 'bin.cjs'), 'studio', '--config', config, '--host', '127.0.0.1', '--port', String(port)], { cwd: cache, stdio: ['ignore', 'pipe', 'inherit'] });
studio.stdout.on('data', () => {}); 

const tailscale = new Tailscale();
let served: { name: string; https: number; target: string } | null = null;
const end = () => {
  if (served) tailscale.unserveSync(served.name, served);
  served = null;
  studio.kill();
};
process.on('SIGINT', () => (end(), process.exit(0)));
process.on('SIGTERM', () => (end(), process.exit(0)));
studio.on('exit', (code) => {
  end();
  if (code) fail(`drizzle-kit studio ended (${code})`);
  process.exit(0);
});


const until = Date.now() + 30_000;
while (!(await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false))) {
  if (Date.now() > until) (end(), fail(`drizzle-kit studio did not start on port ${port}`));
  await Bun.sleep(250);
}

const page = (host?: string, https?: number) => `https://local.drizzle.studio/${host ? `?host=${host}&port=${https}` : port === 4983 ? '' : `?port=${port}`}`;
console.log(`Drizzle Studio on ${live ? `${db} (live: edits reach the running Seismic)` : `a copy of ${db} taken now`}`);
console.log(`  this machine:   ${page()}`);
if (!local) {
  const ts = await tailscale.state();
  if (ts.state !== 'ready') console.log(`  other devices:  not served (Tailscale: ${ts.state})`);
  else {
    const r = await tailscale.serve(ts.name, port, null);
    if ('problem' in r) console.log(`  other devices:  not served (${r.problem.code === 'portsTaken' ? 'every HTTPS port Tailscale may serve is taken' : (r.problem as { detail?: string }).detail ?? r.problem.code})`);
    else {
      served = { name: ts.name, ...r.entry };
      console.log(`  other devices:  ${page(ts.name, r.entry.https)}`);
    }
  }
}
console.log('Ctrl-C ends it.');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
