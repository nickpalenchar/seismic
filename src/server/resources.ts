






import { seismicEnv } from '../core/env';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import pkg from '../../package.json';

/** Whether this is a path in Bun's embedded file system (`/$bunfs/…`, `B:\~BUN\…` on Windows). */
export const embedded = (path: string) => path.startsWith('/$bunfs/') || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(path);


export const COMPILED = embedded(import.meta.path);


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


export const SELF: string[] = COMPILED ? [process.execPath] : [process.execPath, Bun.main];





export const BUN_ENV: Record<string, string> = COMPILED ? { BUN_BE_BUN: '1' } : {};
