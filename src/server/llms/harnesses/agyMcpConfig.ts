import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GIT } from '../../workstations';
import { AGY_BRIDGE_COMMAND, AGY_SERVER } from './agyMcp';

const configPath = '.agents/mcp_config.json';
const lockPath = '.agents/.seismic-mcp.lock';
const bridge = JSON.stringify({ mcpServers: { [AGY_SERVER]: AGY_BRIDGE_COMMAND } }, null, 2) + '\n';

function ignoreFiles(cwd: string) {
  const exclude = spawnSync(GIT, ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { encoding: 'utf8', windowsHide: true });
  if (exclude.status !== 0) return;
  const path = exclude.stdout.trim();
  const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const missing = [configPath, lockPath].map((name) => '/' + name).filter((line) => !content.split('\n').includes(line));
  if (!missing.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, (content && !content.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
}

/**
 * Each running session holds a SQLite read lock for this checkout. A reserved lock serializes
 * installation and lease acquisition. Removal requires the exclusive lock, which can only be
 * taken after every process releases its read lock. The empty lock file stays on the same inode
 * across sessions so concurrent processes always share one lock.
 */
export function installMcpConfig(cwd: string): () => void {
  const checkout = realpathSync(cwd);
  const file = join(checkout, configPath);
  const lock = join(checkout, lockPath);
  const installed = () => {
    const entry = lstatSync(file, { throwIfNoEntry: false });
    if (!entry) return false;
    if (!entry.isFile() || readFileSync(file, 'utf8') !== bridge) throw new Error(`Antigravity cannot start here: the workstation has its own ${configPath}`);
    return true;
  };
  ignoreFiles(checkout);
  mkdirSync(dirname(lock), { recursive: true });
  const lockEntry = lstatSync(lock, { throwIfNoEntry: false });
  if (lockEntry && (!lockEntry.isFile() || lockEntry.size !== 0)) throw new Error(`Antigravity cannot use the checkout lock at ${lock}`);

  const gate = new Database(lock);
  let reader: Database | undefined;
  try {
    gate.exec('PRAGMA busy_timeout = 1000; BEGIN IMMEDIATE');
    const existing = installed();
    reader = new Database(lock, { readonly: true, create: false });
    reader.exec('BEGIN');
    reader.query('SELECT name FROM sqlite_schema').all();
    if (!existing) writeFileSync(file, bridge, { flag: 'wx', mode: 0o600 });
    gate.exec('ROLLBACK');
  } catch (error) {
    reader?.close();
    gate.close();
    throw error;
  }
  return () => {
    try {
      reader.close();
      // Give another process releasing its last reader a moment to leave the lock.
      gate.exec('PRAGMA busy_timeout = 25; BEGIN EXCLUSIVE');
      if (installed()) rmSync(file);
    } catch {
      // Another session holds a lease, the checkout is gone, or it now has its own config.
    } finally {
      gate.close();
    }
  };
}
