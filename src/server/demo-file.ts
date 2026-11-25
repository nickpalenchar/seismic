


import { realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * A file of a demo's directory by its path there: the file itself where it is one and lies inside the
 * directory, else null. A link to a file outside counts as outside: the worker made the directory,
 * and what is in it is served, published and passed on.
 */
export function demoFile(dir: string, name: string): string | null {
  try {
    const root = realpathSync(dir);
    const path = realpathSync(resolve(root, name));
    return path.startsWith(root + sep) && statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}
