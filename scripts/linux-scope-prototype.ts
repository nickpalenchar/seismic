// Experimental Linux process boundary, not used by Seismic: each session in a transient systemd user
// scope of its own. `systemd-run --user --scope` has the user manager move systemd-run's own process
// into a new cgroup and only then execs the command in place (same pid, same stdio), so no agent
// code runs outside it: the launch is gated by construction. A shell in between reports the cgroup it
// finds itself in on a private pipe (fd 3), closes it and execs the agent, which is how the caller
// learns that the scope holds: systemd-run that cannot reach a manager exits before running anything,
// and the caller may then start the agent without a scope (the existing tracking, agent-processes.ts).
// Ending the session writes `cgroup.kill` (Linux 5.14+, cgroup v2), which the kernel applies to
// every member at once, forks during the kill included; no pid is looked up, so nothing races reuse.
// Where that file cannot be written (a read-only cgroupfs, an older kernel), `systemctl --user kill`
// asks the manager instead. A scope outlives the caller's death, and its unit name (random per
// session) is not given to anything else while it exists, so a later sweep can end it by name.
// What it does not hold: a process that asks the manager for a unit of its own (systemd-run, D-Bus
// activation) or moves itself to another cgroup the user owns leaves it. See docs/plan/codex-runtime.md
// ("Platform process boundaries").
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const CGROUP_ROOT = '/sys/fs/cgroup';

export type Unavailable = { boundary: 'none'; reason: string };

export interface Scope {
  unit: string;
  /** The scope's cgroup, relative to the cgroup2 mount. */
  cgroup: string;
  /** Pids in the scope now (empty once it is gone). */
  members(): number[];
  /** Ends every process in the scope; says which way it took. */
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
    // the scope emptied and was collected in between
    if (code === 'ENOENT' && !existsSync(`${CGROUP_ROOT}${cgroup}`)) return 'gone';
    // EROFS: cgroupfs mounted read-only here; ENOENT: no cgroup.kill (before 5.14); EACCES: not ours to write
    if (!['EROFS', 'ENOENT', 'EACCES', 'EPERM'].includes(code ?? '')) throw error;
  }
  const r = spawnSync('systemctl', ['--user', 'kill', '--signal=SIGKILL', unit], { env, encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0 && existsSync(`${CGROUP_ROOT}${cgroup}`)) throw new Error(`systemctl --user kill ${unit}: ${r.stderr.trim() || r.status}`);
  return 'systemctl';
}

// fd 3 is the report pipe: the shell writes its cgroup there, closes it and execs the agent.
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
  const unit = `${options.unit ?? `obeya-${randomUUID()}`}.scope`;
  const stdio = options.stdio ?? ['pipe', 'pipe', 'pipe'];
  const child = spawn(systemdRun, ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', '/bin/sh', '-c', GATE, 'obeya-scope-gate', command, ...args], {
    cwd: options.cwd, env: options.env, stdio: [...stdio.slice(0, 3), 'pipe'], detached: true,
  });
  const report = child.stdio[3] as NodeJS.ReadableStream;
  let stderr = '';
  // systemd-run's own complaint, when it cannot start the scope, goes to the agent's stderr
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
    // not where we asked to be: refuse to call it ours, and stop what started
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ }
    return { boundary: 'none', reason: `started in ${cgroup}, not in ${unit}` };
  }
  return {
    boundary: 'scope',
    child,
    scope: { unit, cgroup, members: () => members(cgroup), kill: () => killScope(unit, cgroup, options.env) },
  };
}
