


import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';

export interface ProcessInfo { pid: number; parent: number; group: number; born: string }

const windowsSnapshotCommand = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress';
const powershell = ['-NoProfile', '-NonInteractive', '-Command', windowsSnapshotCommand];

type Run = { status: number | null; stdout: string; error?: NodeJS.ErrnoException };

/** A snapshot that did not finish in its time: on a busy machine that passes, unlike a refusal. */
export const timedOut = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';

function failed(r: Run): never {
  if (timedOut(r.error)) throw Object.assign(new Error('Agent process snapshot timed out'), { code: 'ETIMEDOUT' });
  throw new Error('Cannot inspect agent process ownership');
}

/** Like spawnSync, without holding the event loop while the command runs. */
function run(command: string, args: string[], timeout: number): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let stdout = '';
    let error: NodeJS.ErrnoException | undefined;
    child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text; });
    const timer = setTimeout(() => { error = Object.assign(new Error(`${command} timed out`), { code: 'ETIMEDOUT' }); child.kill('SIGKILL'); }, timeout);
    child.on('error', (e) => { error ??= e; });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status: error ? null : status, stdout, ...(error ? { error } : {}) }); });
  });
}

/** A cold PowerShell/CIM launch can exceed the normal snapshot budget on Windows. */
export class WindowsProcessSnapshot {
  private first = true;
  constructor(
    private runSync: (timeout: number) => Run = (timeout) => spawnSync('powershell.exe', powershell, { encoding: 'utf8', windowsHide: true, timeout }),
    private runAsync: (timeout: number) => Promise<Run> = (timeout) => run('powershell.exe', powershell, timeout),
  ) {}

  private budget() { return this.first ? 15_000 : 3_000; }
  
  private retry(r: Run) { return !this.first && r.error?.code === 'ETIMEDOUT'; }

  read(): ProcessInfo[] {
    const r = this.runSync(this.budget());
    return this.parse(this.retry(r) ? this.runSync(15_000) : r);
  }

  async readAsync(): Promise<ProcessInfo[]> {
    const r = await this.runAsync(this.budget());
    return this.parse(this.retry(r) ? await this.runAsync(15_000) : r);
  }

  private parse(result: Run): ProcessInfo[] {
    if (result.status !== 0) failed(result);
    const rows: unknown = JSON.parse(result.stdout);
    this.first = false;
    return (Array.isArray(rows) ? rows : [rows]).flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const p = row as Record<string, unknown>;
      return typeof p.ProcessId === 'number' && typeof p.ParentProcessId === 'number' && typeof p.CreationDate === 'string'
        ? [{ pid: p.ProcessId, parent: p.ParentProcessId, group: p.ProcessId, born: p.CreationDate }] : [];
    });
  }
}

const windowsSnapshot = new WindowsProcessSnapshot();

let bootId: string | undefined;
/** Start ticks count from boot, so two boots (or containers restarted over the same pids) can repeat them. */
function linuxBootId(): string {
  if (bootId === undefined) {
    try { bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { bootId = ''; }
  }
  return bootId;
}

/**
 * Whether a recorded creation identity is the one now seen for the pid. Records written before the
 * boot id joined the identity hold bare start ticks; the caller has already matched the record's
 * boot, so those compare against the ticks part of a current identity.
 */
export function sameBirth(recorded: string, current: string): boolean {
  return recorded === current || (!recorded.includes(':') && current.endsWith(`:${recorded}`));
}

/** /proc/<pid>/stat's command is parenthesized and can itself contain spaces and parentheses. */
export function linuxProcessStat(stat: string, boot = linuxBootId()): ProcessInfo | undefined {
  const open = stat.indexOf(' (');
  const end = stat.lastIndexOf(')');
  if (open < 1 || end <= open) return;
  const pid = Number(stat.slice(0, open));
  
  const fields = stat.slice(end + 1).trim().split(/\s+/);
  const parent = Number(fields[1]), group = Number(fields[2]), born = fields[19];
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(parent) || parent < 0 || !Number.isSafeInteger(group) || group <= 0 || !born || !/^\d+$/.test(born)) return;
  return { pid, parent, group, born: boot ? `${boot}:${born}` : born };
}


interface Table { rows: ProcessInfo[]; denied: Map<number, unknown> }

function linuxProcess(name: string, read: () => string, denied: Table['denied']): ProcessInfo[] {
  try {
    const p = linuxProcessStat(read());
    return p && p.pid === Number(name) ? [p] : [];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (['ENOENT', 'ESRCH'].includes(code)) return []; 
    if (['EACCES', 'EPERM'].includes(code)) { denied.set(Number(name), error); return []; } 
    throw error;
  }
}

/** Never silently lose a process already known to belong to the agent. */
function rowsFor(table: Table, required: Set<number>): ProcessInfo[] {
  for (const pid of required) if (table.denied.has(pid)) throw table.denied.get(pid);
  return table.rows;
}


const linuxNames = (listed: string[], required: Set<number>) => new Set([...listed, ...[...required].map(String)]);

const psArgs = ['-axo', 'pid=,ppid=,pgid=,lstart='];

function psRows(r: Run): ProcessInfo[] {
  if (r.status !== 0) failed(r);
  return r.stdout.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), group: Number(m[3]), born: m[4]! }] : [];
  });
}

/** The process table, blocking: only for the sweep at start, before the server serves anyone. */
export function processes(required = new Set<number>()): ProcessInfo[] {
  if (process.platform === 'linux') {
    const denied: Table['denied'] = new Map();
    const rows = [...linuxNames(readdirSync('/proc'), required)].flatMap((name) =>
      /^\d+$/.test(name) ? linuxProcess(name, () => readFileSync(`/proc/${name}/stat`, 'utf8'), denied) : []);
    return rowsFor({ rows, denied }, required);
  }
  if (process.platform === 'win32') return windowsSnapshot.read();
  return psRows(spawnSync('ps', psArgs, { encoding: 'utf8', timeout: 3000 }));
}

async function table(required: Set<number>): Promise<Table> {
  const denied: Table['denied'] = new Map();
  if (process.platform === 'linux') {
    const names = [...linuxNames(await readdir('/proc'), required)].filter((name) => /^\d+$/.test(name));
    const stats = await Promise.all(names.map(async (name) => {
      try { return { name, stat: await readFile(`/proc/${name}/stat`, 'utf8') }; } catch (error) { return { name, error }; }
    }));
    const rows = stats.flatMap((s) => linuxProcess(s.name, () => { if ('error' in s) throw s.error; return s.stat; }, denied));
    return { rows, denied };
  }
  if (process.platform === 'win32') return { rows: await windowsSnapshot.readAsync(), denied };
  return { rows: psRows(await run('ps', psArgs, 3000)), denied };
}

/** The process table without holding the event loop: a busy machine's `ps` can take seconds. */
export async function processesAsync(required = new Set<number>()): Promise<ProcessInfo[]> {
  return rowsFor(await table(required), required);
}

/**
 * Every caller that asks before a snapshot starts shares it, so the sessions' ticks cost one `ps`
 * between them. A caller that asks while one is running waits for the next: no caller is given a
 * table older than its request, which a kill depends on.
 */
export function sharedSnapshot(take: (required: Set<number>) => Promise<Table>) {
  let tail: Promise<unknown> = Promise.resolve();
  let waiting: { required: Set<number>; table: Promise<Table> } | undefined;
  return async (required: Set<number>): Promise<ProcessInfo[]> => {
    if (!waiting) {
      const batch: { required: Set<number>; table?: Promise<Table> } = { required: new Set() };
      batch.table = tail.then(async () => {
        
        await new Promise((resolve) => setImmediate(resolve));
        if (waiting === batch) waiting = undefined;
        return take(batch.required);
      });
      tail = batch.table.catch(() => {});
      waiting = batch as { required: Set<number>; table: Promise<Table> };
    }
    const batch = waiting;
    for (const pid of required) batch.required.add(pid);
    return rowsFor(await batch.table, required);
  };
}

const sharedProcesses = sharedSnapshot(table);

/**
 * Lets an operation's snapshot time out without failing it, until they have done so for `window`
 * on end: a busy machine skips an observation, while ownership that cannot be watched at all still
 * ends the session.
 */
export function tolerateTimeouts(window = 30_000, now = Date.now) {
  let since: number | undefined;
  return (operation: Promise<void>): Promise<void> => operation.then(() => { since = undefined; }, (error: unknown) => {
    if (timedOut(error) && now() - (since ??= now()) < window) return;
    throw error;
  });
}

/**
 * Calls `settle` once, when the session's process has exited and its pipes have closed, or `grace`
 * after its exit where they are still open: a command it started that was never observed (reparented
 * between two observations) can hold them for as long as it runs. Its pipes are then let go.
 */
export function onceClosed(child: ChildProcess, settle: (code: number | null, signal: NodeJS.Signals | null) => void, grace = 2000) {
  let settled = false;
  let held: ReturnType<typeof setTimeout> | undefined;
  const once = (code: number | null, signal: NodeJS.Signals | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(held);
    settle(code, signal);
  };
  child.on('exit', (code, signal) => {
    held = setTimeout(() => {
      for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe?.destroy();
      once(code, signal);
    }, grace);
  });
  child.on('close', once);
}

/**
 * Observes until the session's own process is identified, trying a timed-out snapshot again, so a
 * record published after it names that process; rejects once `watch` lets a failure through.
 */
export async function untilIdentified(terminals: AgentProcesses, watch: (operation: Promise<void>) => Promise<void>) {
  for (;;) {
    await watch(terminals.track());
    if (terminals.observed().length) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Only register descendants while ownership is provable; remember their creation time against PID reuse.
 * Snapshots are taken without blocking the event loop and shared with the other sessions' trackers,
 * so every operation waits for the ones before it: a kill always sees what an earlier track registered.
 */
export class AgentProcesses {
  private owned = new Map<number, ProcessInfo>();
  private rootBorn?: string;
  private snapshotError?: unknown;
  private queue: Promise<unknown>;
  constructor(private parent: number, private snapshot: (required: Set<number>) => ProcessInfo[] | Promise<ProcessInfo[]> = sharedProcesses) {
    this.queue = this.establish().catch(() => {});
  }

  /** A snapshot that timed out leaves ownership to be established by the next operation. */
  private async establish() {
    if (this.rootBorn !== undefined) return;
    if (this.snapshotError) throw this.snapshotError;
    try {
      const root = (await this.snapshot(new Set([this.parent]))).find((p) => p.pid === this.parent && p.parent === process.pid);
      if (!root) throw new Error('Cannot establish agent process ownership');
      this.rootBorn = root.born;
    } catch (error) {
      if (!timedOut(error)) this.snapshotError = error;
      throw error;
    }
  }

  /** Runs after every operation queued before it, whether that one failed or not. */
  private then<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private async table(extra: number[] = []) {
    return new Map((await this.snapshot(new Set([this.parent, ...this.owned.keys(), ...extra]))).map((p) => [p.pid, p]));
  }

  private signature() { return [...this.owned.values()].map((p) => `${p.pid}:${p.born}`).join('|'); }

  
  onChange?: (observed: { pid: number; born: string }[]) => void;

  track(pids?: number[]): Promise<void> {
    return this.then(async () => {
      await this.establish();
      const before = this.signature();
      const table = await this.table();
      
      
      for (const pid of pids ?? table.keys()) {
        const info = table.get(pid);
        let p = info;
        const seen = new Set<number>();
        const chain: ProcessInfo[] = [];
        while (p && !(p.pid === this.parent && this.rootBorn !== undefined && p.born === this.rootBorn) && this.owned.get(p.pid)?.born !== p.born && !seen.has(p.pid)) {
          seen.add(p.pid);
          chain.push(p);
          p = table.get(p.parent);
        }
        if (info && p && ((p.pid === this.parent && this.rootBorn !== undefined && p.born === this.rootBorn) || this.owned.get(p.pid)?.born === p.born)) {
          
          
          for (const member of chain.reverse()) this.owned.set(member.pid, member);
        }
      }
      
      if (this.signature() !== before) this.onChange?.(this.observed());
    });
  }

  /**
   * Identities that Seismic's own liveness supervisor (the root) observed, never ones an agent
   * reported: each is kept only while its process still has the reported creation identity (to the
   * second on macOS, so a PID reused within that second passes). Unlike `track`, no ancestry is
   * needed, so they stay attributable after the supervisor has died.
   */
  adopt(reported: { pid: number; born: string }[]): Promise<void> {
    return this.then(async () => {
      await this.establish();
      const table = await this.table(reported.map((r) => r.pid));
      for (const { pid, born } of reported) {
        const current = table.get(pid);
        if (current?.born === born && pid !== this.parent) this.owned.set(pid, current);
      }
    });
  }

  /** Snapshot of previously observed identities, for report-only experiments; not signal authority. */
  observed(): { pid: number; born: string }[] {
    return [
      ...(this.rootBorn === undefined ? [] : [{ pid: this.parent, born: this.rootBorn }]),
      ...[...this.owned.values()].map(({ pid, born }) => ({ pid, born })),
    ];
  }

  kill(): Promise<void> {
    return this.then(async () => {
      if (!this.owned.size) return;
      
      
      const { signalled, failure } = await terminateAsync(this.owned.values(), await this.table());
      for (const pid of signalled) this.owned.delete(pid);
      if (failure === undefined) this.owned.clear();
      else throw failure;
    });
  }
}

/**
 * Signals the processes in `owned` that are still the ones recorded (same creation identity in
 * `table`), and every descendant of those: children that detached into another group while their
 * parent lived are still children in the table. Returns the pids that are gone or were signalled,
 * and the first failure. With `signalGroups` off, a group leader is signalled alone: a group number
 * proves nothing about who else is in the group. A recorded process whose pid now shows another birth is not a target.
 */
export function terminate(owned: Iterable<ProcessInfo>, table: Map<number, ProcessInfo>, signalGroups = true): { signalled: number[]; failure?: unknown } {
  const targets = targetsOf(owned, table);
  const signalled: number[] = [];
  let failure: unknown;
  for (const p of [...targets.values()].reverse()) {
    if (process.platform === 'win32') {
      
      const r = spawnSync('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 3000 });
      if (r.status !== 0 && r.status !== 128) { failure ??= r.error ?? new Error(`taskkill failed for ${p.pid} (${r.status})`); continue; }
    } else {
      try { process.kill(signalGroups && p.group === p.pid ? -p.pid : p.pid, 'SIGKILL'); } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') continue;
        failure ??= e;
        continue;
      }
    }
    signalled.push(p.pid);
  }
  return { signalled, ...(failure === undefined ? {} : { failure }) };
}

/** Ends the process `pid` and its tree with `taskkill`, without holding the event loop; the exit status (null: it did not run or timed out). */
export function taskkillTree(pid: number, timeout = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, timeout);
    child.once('error', () => { clearTimeout(timer); resolve(null); });
    child.once('close', (status) => { clearTimeout(timer); resolve(status); });
  });
}

/** `terminate` without holding the event loop on Windows, where each `taskkill` takes its time. */
export async function terminateAsync(owned: Iterable<ProcessInfo>, table: Map<number, ProcessInfo>, signalGroups = true, taskkill: (pid: number) => Promise<number | null> = taskkillTree, windows = process.platform === 'win32'): Promise<{ signalled: number[]; failure?: unknown }> {
  if (!windows) return terminate(owned, table, signalGroups);
  const signalled: number[] = [];
  let failure: unknown;
  for (const p of [...targetsOf(owned, table).values()].reverse()) {
    const status = await taskkill(p.pid);
    
    if (status !== 0 && status !== 128) { failure ??= new Error(`taskkill failed for ${p.pid} (${status})`); continue; }
    signalled.push(p.pid);
  }
  return { signalled, ...(failure === undefined ? {} : { failure }) };
}

function targetsOf(owned: Iterable<ProcessInfo>, table: Map<number, ProcessInfo>): Map<number, ProcessInfo> {
  const targets = new Map<number, ProcessInfo>();
  for (const info of owned) {
    const current = table.get(info.pid);
    if (current && sameBirth(info.born, current.born)) targets.set(current.pid, current);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of table.values()) if (targets.has(p.parent) && !targets.has(p.pid)) { targets.set(p.pid, p); changed = true; }
  }
  return targets;
}
