














import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const CGROUP_ROOT = '/sys/fs/cgroup';

export type Unavailable = { boundary: 'none'; reason: string };

export interface Scope {
  unit: string;
  
  cgroup: string;
  
  members(): number[];
  
  kill(): 'cgroup.kill' | 'systemctl' | 'gone';
}

/** Whether the unified (v2) hierarchy is mounted where systemd puts it; v1 hosts are not tested. */
export function unifiedCgroups(mounts = safeRead('/proc/self/mounts')): boolean {
  return mounts.split('\n').some((line) => { const [, at, type] = line.split(' '); return at === CGROUP_ROOT && type === 'cgroup2'; });
}

function safeRead(file: string) { try { return readFileSync(file, 'utf8'); } catch { return ''; } }

/** Pids of the cgroup's own members (a scope without delegation has no sub-cgroups of its own). */
export function members(cgroup: string): number[] {
  return safeRead(`${CGROUP_ROOT}${cgroup}/cgroup.procs`).split('\n').filter(Boolean).map(Number);
}

/** Ends a scope by unit and cgroup: for the live session and for a sweep after the caller died alike. */
export function killScope(unit: string, cgroup: string, env: NodeJS.ProcessEnv = process.env): 'cgroup.kill' | 'systemctl' | 'gone' {
  if (!existsSync(`${CGROUP_ROOT}${cgroup}`)) return 'gone';
  try {
    writeFileSync(`${CGROUP_ROOT}${cgroup}/cgroup.kill`, '1');
    return 'cgroup.kill';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    
    if (code === 'ENOENT' && !existsSync(`${CGROUP_ROOT}${cgroup}`)) return 'gone';
    
    if (!['EROFS', 'ENOENT', 'EACCES', 'EPERM'].includes(code ?? '')) throw error;
  }
  const r = spawnSync('systemctl', ['--user', 'kill', '--signal=SIGKILL', unit], { env, encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0 && existsSync(`${CGROUP_ROOT}${cgroup}`)) throw new Error(`systemctl --user kill ${unit}: ${r.stderr.trim() || r.status}`);
  return 'systemctl';
}


const GATE = 'cat /proc/self/cgroup >&3 || exit 125; exec 3>&-; exec "$@"';

/**
 * Starts `command` in a scope of its own, or says why it cannot. Settles once the scope is known
 * to hold the agent, or once systemd-run has exited without running it; in that case no agent code
 * ran and the caller may start it without a scope.
 */
export async function launchInScope(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: ('pipe' | 'inherit' | 'ignore')[]; unit?: string } = {},
): Promise<{ boundary: 'scope'; child: ChildProcess; scope: Scope } | Unavailable> {
  if (process.platform !== 'linux') return { boundary: 'none', reason: 'not Linux' };
  if (!unifiedCgroups()) return { boundary: 'none', reason: 'no cgroup v2 hierarchy at /sys/fs/cgroup' };
  const systemdRun = Bun.which('systemd-run', { PATH: options.env?.PATH ?? process.env.PATH ?? '' });
  if (!systemdRun) return { boundary: 'none', reason: 'no systemd-run' };
  const unit = `${options.unit ?? `seismic-${randomUUID()}`}.scope`;
  const stdio = options.stdio ?? ['pipe', 'pipe', 'pipe'];
  const child = spawn(systemdRun, ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', '/bin/sh', '-c', GATE, 'seismic-scope-gate', command, ...args], {
    cwd: options.cwd, env: options.env, stdio: [...stdio.slice(0, 3), 'pipe'], detached: true,
  });
  const report = child.stdio[3] as NodeJS.ReadableStream;
  let stderr = '';
  
  if (stdio[2] === 'pipe') child.stderr!.on('data', (chunk: Buffer) => { if (stderr.length < 4000) stderr += chunk.toString(); });
  const reported = await new Promise<string | undefined>((resolve) => {
    let text = '';
    report.on('data', (chunk: Buffer) => { text += chunk.toString(); });
    report.on('end', () => resolve(text || undefined));
    report.on('error', () => resolve(undefined));
  });
  const cgroup = /^0::(\/.*)$/m.exec(reported ?? '')?.[1];
  if (!cgroup) {
    const code = await new Promise<number | null>((resolve) => child.exitCode !== null ? resolve(child.exitCode) : child.once('exit', (c) => resolve(c)));
    return { boundary: 'none', reason: `systemd-run exited (${code})${stderr.trim() ? `: ${stderr.trim()}` : ''}` };
  }
  if (!cgroup.endsWith(`/${unit}`)) {
    
    try { process.kill(-child.pid!, 'SIGKILL'); } catch {  }
    return { boundary: 'none', reason: `started in ${cgroup}, not in ${unit}` };
  }
  return {
    boundary: 'scope',
    child,
    scope: { unit, cgroup, members: () => members(cgroup), kill: () => killScope(unit, cgroup, options.env) },
  };
}
