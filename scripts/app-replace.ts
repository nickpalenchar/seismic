







import { copyFileSync, chmodSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Puts `from` at `to` in one step for whoever starts it, also while the app at `to` runs: copied beside it first, then renamed into its place. */
export function replace(from: string, to: string, inUse: (dir: string) => boolean = opened) {
  const fresh = `${to}.new`;
  rmSync(fresh, { recursive: true, force: true });
  
  const copy = process.platform === 'darwin' ? Bun.spawnSync(['ditto', from, fresh]).exitCode === 0 : (copyFileSync(from, fresh), true);
  if (!copy) throw new Error(`could not copy ${from}`);
  if (process.platform === 'darwin') {
    
    
    if (existsSync(to)) renameSync(to, `${to}.old-${Date.now().toString(36)}`);
    renameSync(fresh, to);
    for (const old of asides(to)) if (!inUse(old)) rmSync(old, { recursive: true, force: true });
  } else if (process.platform === 'win32') {
    
    const old = to.replace(/\.exe$/, '.old.exe');
    rmSync(old, { force: true });
    if (existsSync(to)) renameSync(to, old);
    renameSync(fresh, to);
    try {
      rmSync(old, { force: true });
    } catch {
      
    }
  } else {
    
    chmodSync(fresh, 0o755);
    renameSync(fresh, to);
  }
}

/** The bundles earlier installs moved aside from `to`. */
export function asides(to: string): string[] {
  const dir = dirname(to);
  const name = `${basename(to)}.old`;
  return readdirSync(dir)
    .filter((f) => f === name || f.startsWith(`${name}-`))
    .map((f) => join(dir, f));
}

/** Whether a process has a file in `dir` open (a shell started from it, its program); yes when there is no lsof to ask. */
function opened(dir: string): boolean {
  try {
    return Bun.spawnSync(['lsof', '-t', '+D', dir], { stderr: 'ignore' }).stdout.toString().trim() !== '';
  } catch {
    return true;
  }
}
