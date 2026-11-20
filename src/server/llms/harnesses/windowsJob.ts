/**
 * A Windows job object, which ends everything in it at once, however the parents between its
 * members have exited since: a job holds its members by handle, not by the pid and parent links a
 * process table gives, which a parent that has exited breaks and a reused pid fakes. A process
 * assigned to it brings every process it starts from then on into the job, so it is created
 * empty, and the first process is assigned before it starts anything (`runAgy`: a launcher that
 * waits on stdin). Its members die with it: once the handle closes, which Seismic ending any way
 * does too, nothing of the run is left behind; a job that cannot be set up so is not handed out.
 */
export interface ProcessJob {
  /** Puts the process `pid` into the job; whether that was done. */
  assign(pid: number): boolean;
  /** Ends every process in the job; whether that was done. */
  terminate(): boolean;
  /** Lets go of the handle, which ends what is still in the job. */
  close(): void;
}

const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
/** `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` on 64-bit Windows: 144 bytes, `LimitFlags` at 16. */
const EXTENDED_LIMIT_SIZE = 144;
const LIMIT_FLAGS_OFFSET = 16;

/** A new, empty job that ends its members when closed, or `undefined` where there is none such to be had (not Windows, no kernel32 through FFI, kill on close refused). */
export function windowsJob(): ProcessJob | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    // loaded here, so that no other platform ever asks for kernel32
    const { dlopen, FFIType, ptr } = require('bun:ffi') as typeof import('bun:ffi');
    const { symbols: k } = dlopen('kernel32.dll', {
      CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
      SetInformationJobObject: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
      AssignProcessToJobObject: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      TerminateJobObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    });
    const job = k.CreateJobObjectW(null, null);
    if (!job) return undefined;
    // the members go with the handle: a job without that would let a helper outlive the run once
    // the handle closes, and closing it is also how a run is ended where terminating fails
    const limits = new Uint8Array(EXTENDED_LIMIT_SIZE);
    new DataView(limits.buffer).setUint32(LIMIT_FLAGS_OFFSET, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, true);
    if (!k.SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, ptr(limits), EXTENDED_LIMIT_SIZE)) {
      k.CloseHandle(job);
      return undefined;
    }
    let closed = false;
    return {
      assign: (pid) => {
        if (closed) return false;
        const proc = k.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if (!proc) return false;
        const assigned = k.AssignProcessToJobObject(job, proc) !== 0;
        k.CloseHandle(proc);
        return assigned;
      },
      terminate: () => !closed && k.TerminateJobObject(job, 1) !== 0,
      close: () => {
        if (closed) return;
        closed = true;
        k.CloseHandle(job);
      },
    };
  } catch {
    return undefined;
  }
}
