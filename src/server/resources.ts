// Where Seismic's files are that other processes run or import: the plugin with the demo skill
// (loaded into every worker's session) and the voice sidecars. In the
// checkout they are the checkout's own; the compiled binary (`bun build --compile`, built by
// `scripts/build.ts`) carries its modules in Bun's embedded file system, which no other process
// can read, so its build puts them as real files into a `resources` directory beside it. That
// directory is read-only (a signed app bundle must not change): what Seismic writes goes into its home.

import { seismicEnv } from '../core/env';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import pkg from '../../package.json';

/** Whether this is a path in Bun's embedded file system (`/$bunfs/…`, `B:\~BUN\…` on Windows). */
export const embedded = (path: string) => path.startsWith('/$bunfs/') || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(path);

/** Whether this server runs from the compiled binary rather than from a checkout. */
export const COMPILED = embedded(import.meta.path);

/** Seismic's version (`package.json`); the checkout shows its commit beside it. */
export const VERSION: string = pkg.version;

/**
 * The directory of Seismic's resources: `SEISMIC_RESOURCES` when set; for the binary, `resources`
 * beside it (in a macOS app bundle, which keeps executables and resources apart, `Resources`
 * beside the directory it is in); else the checkout.
 */
export function resourcesDir(env: Record<string, string | undefined> = process.env, compiled = COMPILED, binary = process.execPath): string {
  const given = seismicEnv('RESOURCES', env);
  if (given) return resolve(given);
  if (!compiled) return resolve(import.meta.dir, '..', '..');
  const beside = join(dirname(binary), 'resources');
  const bundle = resolve(dirname(binary), '..', 'Resources');
  return !existsSync(beside) && existsSync(bundle) ? bundle : beside;
}

/** A file or directory among Seismic's resources. */
export const resource = (...parts: string[]) => join(resourcesDir(), ...parts);

/** The command that starts this program again: the binary alone, or Bun with the server's script. */
export const SELF: string[] = COMPILED ? [process.execPath] : [process.execPath, Bun.main];

/**
 * What a script run with Seismic's own Bun (`process.execPath`) needs in its environment: the
 * compiled binary runs it as `bun` would only with `BUN_BE_BUN=1`.
 */
export const BUN_ENV: Record<string, string> = COMPILED ? { BUN_BE_BUN: '1' } : {};
