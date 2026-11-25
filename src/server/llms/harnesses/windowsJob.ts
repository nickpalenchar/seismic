








export interface ProcessJob {
  
  assign(pid: number): boolean;
  
  terminate(): boolean;
  
  close(): void;
}

const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;

const EXTENDED_LIMIT_SIZE = 144;
const LIMIT_FLAGS_OFFSET = 16;

/** A new, empty job that ends its members when closed, or `undefined` where there is none such to be had (not Windows, no kernel32 through FFI, kill on close refused). */
export function windowsJob(): ProcessJob | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    
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
