// Experimental Windows process boundary, not used by Seismic: each session in a Job Object of its own.
// A job is inherited by every process created inside it, detached or in a new console alike, and
// TerminateJobObject ends all of its members (and those of jobs nested in it) by the job's handle, so
// nothing is looked up by pid. With JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE the kernel also ends them when
// the last handle closes, which is when the caller dies: no sweep is needed after a crash.
// Gated launch: Bun cannot create a process suspended, so the caller starts a gate (this script, run
// with `gate`) that waits until it finds itself in the named job, which the caller assigns it to by
// the handle of a process it started and that is still waiting, and only then starts the agent with
// the gate's own stdio; the agent and everything it starts are in the job from their first
// instruction. The gate stays the agent's parent and exits with its code.
// What it does not hold: a process created by another process outside the job on the agent's
// behalf (WMI's Win32_Process.Create, the task scheduler, a service, an already running app handed a
// request) is not in it. Breakaway (CREATE_BREAKAWAY_FROM_JOB) needs JOB_OBJECT_LIMIT_BREAKAWAY_OK,
// which this job does not set. See docs/plan/codex-runtime.md ("Platform process boundaries").
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dlopen, FFIType, ptr, type Pointer } from 'bun:ffi';

const JobObjectBasicAccountingInformation = 1;
const JobObjectBasicProcessIdList = 3;
const JobObjectExtendedLimitInformation = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const JOB_OBJECT_QUERY = 0x0004;
const ERROR_ALREADY_EXISTS = 183;

let k32: ReturnType<typeof load> | undefined;
function load() {
  return dlopen('kernel32.dll', {
    CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    OpenJobObjectW: { args: [FFIType.u32, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    SetInformationJobObject: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    QueryInformationJobObject: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    AssignProcessToJobObject: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    TerminateJobObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    IsProcessInJob: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
    GetCurrentProcess: { args: [], returns: FFIType.ptr },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
    CreateProcessW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  }).symbols;
}
function kernel32() { return (k32 ??= load()); }

function wide(text: string) { return Buffer.from(`${text}\0`, 'utf16le'); }
function lastError() { return kernel32().GetLastError(); }

export type Unavailable = { boundary: 'none'; reason: string };

export interface Job {
  name: string;
  /** Pids in the job now, nested jobs' members included. */
  members(): number[];
  /** How many processes in the job are running. */
  active(): number;
  /** Ends every process in the job. */
  kill(): void;
  /** Gives up the caller's handle: with kill-on-close, the members end now unless another handle is open. */
  close(): void;
}

/** A named job with kill-on-close, no breakaway. */
export function createJob(name = `obeya-${randomUUID()}`, killOnClose = true): { job: Job; handle: Pointer } {
  const k = kernel32();
  const handle = k.CreateJobObjectW(null, ptr(wide(`Local\\${name}`))) as Pointer | null;
  if (!handle) throw new Error(`CreateJobObjectW failed (${lastError()})`);
  // a job of that name existed already: someone else's, never ours to use
  if (lastError() === ERROR_ALREADY_EXISTS) { k.CloseHandle(handle); throw new Error(`job ${name} exists already`); }
  // JOBOBJECT_EXTENDED_LIMIT_INFORMATION on x64: 144 bytes, BasicLimitInformation.LimitFlags at 16
  const limits = new ArrayBuffer(144);
  new DataView(limits).setUint32(16, killOnClose ? JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE : 0, true);
  if (!k.SetInformationJobObject(handle, JobObjectExtendedLimitInformation, ptr(limits), 144)) {
    const error = lastError();
    k.CloseHandle(handle);
    throw new Error(`SetInformationJobObject failed (${error})`);
  }
  let open = true;
  return {
    handle,
    job: {
      name,
      members() {
        if (!open) return [];
        // JOBOBJECT_BASIC_PROCESS_ID_LIST: two DWORDs, then ULONG_PTRs
        const room = 1024;
        const list = new ArrayBuffer(8 + 8 * room);
        if (!k.QueryInformationJobObject(handle, JobObjectBasicProcessIdList, ptr(list), list.byteLength, null)) throw new Error(`QueryInformationJobObject failed (${lastError()})`);
        const view = new DataView(list);
        const count = view.getUint32(4, true);
        return Array.from({ length: count }, (_, i) => Number(view.getBigUint64(8 + 8 * i, true)));
      },
      active() {
        if (!open) return 0;
        // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION: ActiveProcesses at 40
        const info = new ArrayBuffer(48);
        if (!k.QueryInformationJobObject(handle, JobObjectBasicAccountingInformation, ptr(info), 48, null)) throw new Error(`QueryInformationJobObject failed (${lastError()})`);
        return new DataView(info).getUint32(40, true);
      },
      kill() {
        if (open && !k.TerminateJobObject(handle, 1)) throw new Error(`TerminateJobObject failed (${lastError()})`);
      },
      close() { if (open) { open = false; k.CloseHandle(handle); } },
    },
  };
}

/** Puts a process the caller started, and that still runs, into the job by a handle of its own. */
export function assign(handle: Pointer, pid: number) {
  const k = kernel32();
  const process = k.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
  if (!process) throw new Error(`OpenProcess ${pid} failed (${lastError()})`);
  try {
    if (!k.AssignProcessToJobObject(handle, process)) throw new Error(`AssignProcessToJobObject failed (${lastError()})`);
  } finally { k.CloseHandle(process); }
}

/** Whether this process is in any job already (a terminal's, a CI runner's), which makes ours nested. */
export function inAnyJob(): boolean {
  const k = kernel32();
  const result = new Int32Array(1);
  return !!k.IsProcessInJob(k.GetCurrentProcess(), null, ptr(result)) && result[0] !== 0;
}

/** Whether `pid` (this process by default) is in the named job. */
export function inJob(name: string, pid?: number): boolean {
  const k = kernel32();
  const job = k.OpenJobObjectW(JOB_OBJECT_QUERY, 0, ptr(wide(`Local\\${name}`)));
  if (!job) return false;
  const process = pid === undefined ? k.GetCurrentProcess() : k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  try {
    if (!process) return false;
    const result = new Int32Array(1);
    return !!k.IsProcessInJob(process, job, ptr(result)) && result[0] !== 0;
  } finally {
    if (pid !== undefined && process) k.CloseHandle(process);
    k.CloseHandle(job);
  }
}

/**
 * What an agent would do to leave the job: CreateProcessW with CREATE_BREAKAWAY_FROM_JOB. For the
 * probe and tests; returns the new pid, or the error code it was refused with.
 */
export function startBreakingAway(commandLine: string): { pid: number } | { error: number } {
  const k = kernel32();
  const startup = new ArrayBuffer(104); // STARTUPINFOW on x64
  new DataView(startup).setUint32(0, 104, true);
  const info = new ArrayBuffer(24); // PROCESS_INFORMATION
  const CREATE_BREAKAWAY_FROM_JOB = 0x01000000, CREATE_NO_WINDOW = 0x08000000;
  if (!k.CreateProcessW(null, ptr(wide(commandLine)), null, null, 0, CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW, null, null, ptr(startup), ptr(info))) return { error: lastError() };
  const view = new DataView(info);
  k.CloseHandle(Number(view.getBigUint64(0, true)) as unknown as Pointer);
  k.CloseHandle(Number(view.getBigUint64(8, true)) as unknown as Pointer);
  return { pid: view.getUint32(16, true) };
}

/**
 * Starts `command` in a job of its own behind the gate, or says why it cannot. Settles once the gate
 * is in the job; the agent starts only then.
 */
export async function launchInJob(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: ('pipe' | 'inherit' | 'ignore')[]; killOnClose?: boolean; name?: string } = {},
): Promise<{ boundary: 'job'; child: ChildProcess; job: Job } | Unavailable> {
  if (process.platform !== 'win32') return { boundary: 'none', reason: 'not Windows' };
  let made: ReturnType<typeof createJob>;
  try { made = createJob(options.name, options.killOnClose ?? true); } catch (error) { return { boundary: 'none', reason: String(error) }; }
  const child = spawn(process.execPath, [import.meta.path, 'gate', made.job.name, command, ...args], {
    cwd: options.cwd, env: { ...(options.env ?? process.env), BUN_BE_BUN: '1' }, stdio: options.stdio ?? ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  try {
    if (!child.pid) throw new Error('the gate did not start');
    assign(made.handle, child.pid);
  } catch (error) {
    // the gate never ran anything: it waits for the job, and dies with the handle it waits on
    child.kill();
    made.job.close();
    return { boundary: 'none', reason: String(error) };
  }
  return { boundary: 'job', child, job: made.job };
}

// The gate: waits until it is in the named job, then runs the agent with its own stdio.
if (import.meta.main && process.argv[2] === 'gate') {
  const [, , , name, command, ...args] = process.argv;
  const deadline = Date.now() + 10_000;
  while (!inJob(name!)) {
    if (Date.now() > deadline) process.exit(125);
    await Bun.sleep(5);
  }
  const env = { ...process.env };
  delete env.BUN_BE_BUN;
  const agent = spawn(command!, args, { stdio: 'inherit', env, windowsHide: true });
  agent.on('error', () => process.exit(127));
  agent.on('exit', (code) => process.exit(code ?? 1));
}
