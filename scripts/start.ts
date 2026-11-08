// `bun start` of a development checkout (a directory named `…-dev`) starts its Seismic on a home and
// a port of its own, so it runs beside the stable Seismic of another checkout (or the app) without
// meeting its database: one home serves one Seismic (src/server/instance.ts), and a database written
// by a newer Seismic is refused by an older one. In any other checkout the same command starts
// Seismic as src/server/main.ts does, on ~/.obeya and port 4417, so the file can travel between
// the two with a merge.
//
//   bun start [<main.ts args>]      # in a -dev checkout: home ~/.obeya-dev, port 4418
//   bun run dev [<main.ts args>]    # the same, with hot reload (--hot, --dev)
//
// SEISMIC_HOME and SEISMIC_PORT (or --port) still win when set. A first start without arguments on a
// home with no projects.json gets one with this checkout as its only project, so the code can be
// tried at once; copy a database over (stop both first) to start from real cards. Everything else
// is src/server/main.ts, whose header describes the arguments.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const DEFAULT_PORT = '4418';
const root = resolve(import.meta.dir, '..');

/** Whether `dir` is a development checkout: its name ends in `-dev`. */
export const isDevCheckout = (dir: string) => /-dev$/.test(basename(dir));

if (import.meta.main) {
  const hot = process.argv[2] === '--hot';
  const args = process.argv.slice(hot ? 3 : 2);
  const dev = isDevCheckout(root);

  const home = (process.env.SEISMIC_HOME ?? process.env.OBEYA_HOME) ?? join(homedir(), dev ? '.obeya-dev' : '.obeya');
  const env = { ...process.env, ...(dev ? { SEISMIC_HOME: home, SEISMIC_PORT: (process.env.SEISMIC_PORT ?? process.env.OBEYA_PORT) ?? DEFAULT_PORT } : {}) };

  // without arguments the projects come from the home's projects.json
  (await import('../src/server/config')).adoptOldConfig(home);
  const config = join(home, 'projects.json');
  if (dev && args.length === 0 && !existsSync(config)) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(config, JSON.stringify([{ name: 'Seismic', repos: [{ path: root }] }], null, 2) + '\n');
  }

  const child = Bun.spawn(['bun', ...(hot ? ['--hot', join(root, 'src/server/main.ts'), '--dev'] : [join(root, 'src/server/main.ts')]), ...args], {
    cwd: root,
    env,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  // Ctrl-C reaches the whole foreground group already; a kill of this process must reach the server too
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  process.exit(await child.exited);
}
