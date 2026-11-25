

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** The value after `--<name>` on the command line, if given. */
export const opt = (name: string) => {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The PATH with rustup's ~/.cargo/bin added, for a shell that has not picked it up yet. */
export const cargoPath = () => {
  const cargoBin = join(homedir(), '.cargo', 'bin');
  return [process.env.PATH ?? '', ...(existsSync(cargoBin) ? [cargoBin] : [])].join(delimiter);
};

/** The file in `dir` whose name ends in `end` (a bundle Tauri built), if there is one. */
export const endingIn = (dir: string, end: string) => {
  const f = existsSync(dir) && readdirSync(dir).find((f) => f.endsWith(end));
  return f ? join(dir, f) : undefined;
};
