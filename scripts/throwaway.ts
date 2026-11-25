


















import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { machineAddresses } from '../src/server/remote';

const root = resolve(import.meta.dir, '..');

/** A port nothing listens on right now, as the system hands one out. */
const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

/** A new git repository at `path` on `main`, with one commit. */
const scratchRepo = (path: string) => {
  mkdirSync(path);
  writeFileSync(join(path, 'README.md'), '# Scratch\n\nA throwaway repository for a throwaway Seismic.\n');
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(['git', '-c', 'user.name=Seismic', '-c', 'user.email=seismic@localhost', ...args], { cwd: path, stderr: 'pipe' });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
  };
  git('init', '--quiet', '-b', 'main');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Start');
};

if (import.meta.main) {
  let args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const setup = args.includes('--setup');
  const lan = args.includes('--lan');
  args = args.filter((a) => a !== '--keep' && a !== '--setup' && a !== '--lan');

  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seismic-throwaway-')));
  const home = join(dir, 'home');
  const repo = join(dir, 'repo');
  mkdirSync(home, { mode: 0o700 });
  scratchRepo(repo);
  const port = String(await freePort());
  
  if (!setup && !args.some((a) => !a.startsWith('-')))
    writeFileSync(join(home, 'projects.json'), JSON.stringify([{ name: 'Scratch', repos: [{ path: repo }] }], null, 2) + '\n');

  if (lan) {
    const address = machineAddresses()[0];
    if (!address) throw new Error('--lan: this machine has no network address besides loopback');
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ remote: { via: 'address', address } }, null, 2) + '\n');
    console.error(`Network address: http://${address.includes(':') ? `[${address}]` : address}:${port} (the login link below uses it)`);
  }
  console.error(`Throwaway Seismic in ${dir} (home, repo), port ${port}; ${keep ? 'kept' : 'removed'} once it ends`);
  const child = Bun.spawn(['bun', join(root, 'src/server/main.ts'), '--dev', ...args], {
    cwd: root,
    env: { ...process.env, SEISMIC_HOME: home, SEISMIC_PORT: port, ...(lan ? { SEISMIC_LAN_LOGIN: '1' } : {}) },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  const code = await child.exited;
  if (keep) console.error(`Kept: ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}
