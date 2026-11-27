














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

  
  const explicit = process.env.SEISMIC_HOME ?? process.env.OBEYA_HOME;
  const move = explicit ? null : await (await import('../src/server/homeMove')).moveDefaultHome({ dev });
  if (move?.moved) console.log((await import('../src/server/homeMove')).moveNotice(move, join(homedir(), dev ? '.obeya-dev' : '.obeya')));
  const home = explicit ?? move!.home;
  const env = { ...process.env, ...(dev ? { SEISMIC_HOME: home, SEISMIC_PORT: (process.env.SEISMIC_PORT ?? process.env.OBEYA_PORT) ?? DEFAULT_PORT } : {}) };

  
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
  
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  process.exit(await child.exited);
}
