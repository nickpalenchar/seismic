// A throwaway Seismic with this checkout's code: in a fresh temp directory, an empty SEISMIC_HOME and a
// new git repository as its only project, on a free port. Nothing of it touches ~/.obeya,
// ~/.obeya-dev or a repository another Seismic plans (two Seismics on one repository would make
// worktrees and land on its main side by side); the directory is removed once the server ends.
//
//   bun run start:dev:throwaway [--keep] [--setup] [<main.ts args>]
//
// --keep leaves the directory behind (its path is printed) to look at after the server ended.
// --setup starts without a project, so the page shows the setup assistant of a first start (the
// repository is still made, for the assistant to pick).
// Further arguments go to src/server/main.ts as with `bun start` (its header describes them);
// repositories given there replace the scratch one. The server runs with --dev: it does not
// restart when this checkout commits. For cards staged in given states, see scratch-obeya.ts.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
    const r = Bun.spawnSync(['git', '-c', 'user.name=Seismic', '-c', 'user.email=obeya@localhost', ...args], { cwd: path, stderr: 'pipe' });
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
  args = args.filter((a) => a !== '--keep' && a !== '--setup');

  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'obeya-throwaway-')));
  const home = join(dir, 'home');
  const repo = join(dir, 'repo');
  mkdirSync(home, { mode: 0o700 });
  scratchRepo(repo);
  const port = String(await freePort());
  // without repositories on the command line, the projects come from the home's projects.json
  if (!setup && !args.some((a) => !a.startsWith('-')))
    writeFileSync(join(home, 'projects.json'), JSON.stringify([{ name: 'Scratch', repos: [{ path: repo }] }], null, 2) + '\n');

  console.error(`Throwaway Seismic in ${dir} (home, repo), port ${port}; ${keep ? 'kept' : 'removed'} once it ends`);
  const child = Bun.spawn(['bun', join(root, 'src/server/main.ts'), '--dev', ...args], {
    cwd: root,
    env: { ...process.env, SEISMIC_HOME: home, SEISMIC_PORT: port },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  // Ctrl-C reaches the whole foreground group already; a kill of this process must reach the server too
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  const code = await child.exited;
  if (keep) console.error(`Kept: ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}
