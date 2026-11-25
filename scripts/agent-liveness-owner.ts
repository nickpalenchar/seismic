




import { spawn, type ChildProcess, type StdioNull, type StdioPipe } from 'node:child_process';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { AgentProcesses } from '../src/server/llms/harnesses/processes';

export interface Identity { pid: number; born: string }

export interface Supervised {
  
  supervisor: ChildProcess;
  
  agent: Promise<Identity>;
  
  close(): void;
  
  done: Promise<void>;
}

function identity(value: unknown): Identity | undefined {
  if (!value || typeof value !== 'object') return;
  const { pid, born } = value as Record<string, unknown>;
  return Number.isSafeInteger(pid) && (pid as number) > 1 && typeof born === 'string' && born ? { pid: pid as number, born } : undefined;
}

export function superviseAgent(
  argv: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: [StdioNull | StdioPipe, StdioNull | StdioPipe, StdioNull | StdioPipe]; script?: string } = {},
): Supervised {
  const script = options.script ?? join(import.meta.dir, 'agent-liveness-prototype.ts');
  const supervisor = spawn(process.execPath, [script, '--', ...argv], {
    cwd: options.cwd,
    env: { ...(options.env ?? process.env), SEISMIC_LIVENESS_REPORT_FD: '4' },
    stdio: [...(options.stdio ?? ['ignore', 'ignore', 'inherit']), 'pipe', 'pipe'],
    detached: true,
  });
  const tracker = supervisor.pid ? new AgentProcesses(supervisor.pid) : undefined;
  const reports = supervisor.stdio[4] as Readable;
  let failure: unknown;
  let resolveAgent!: (agent: Identity) => void;
  let rejectAgent!: (error: unknown) => void;
  const agent = new Promise<Identity>((resolve, reject) => { resolveAgent = resolve; rejectAgent = reject; });
  void agent.catch(() => {});
  let first = true;
  let buffer = '';
  
  function receive(text: string) {
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    const batch = lines.flatMap((line) => {
      try { const id = identity(JSON.parse(line)); return id ? [id] : []; } catch { return []; }
    });
    if (!batch.length) return;
    if (first) { first = false; resolveAgent(batch[0]!); }
    tracker?.adopt(batch).catch((error: unknown) => { failure ??= error; });
  }
  reports.setEncoding('utf8').on('data', receive);
  const reportsClosed = new Promise<void>((resolve) => reports.once('close', resolve));
  const done = new Promise<void>((resolve, reject) => {
    supervisor.once('error', (error) => { rejectAgent(error); reject(error); });
    
    supervisor.once('exit', async () => {
      
      
      const closed = await Promise.race([reportsClosed.then(() => true), Bun.sleep(1000).then(() => false)]);
      if (!closed) { failure ??= new Error('The supervisor\'s report pipe stayed open after its exit'); reports.destroy(); }
      if (first) rejectAgent(new Error('The supervisor reported no agent'));
      
      await tracker?.kill().catch((error: unknown) => { failure ??= error; });
      (supervisor.stdio[3] as Writable).destroy();
      if (failure === undefined) resolve(); else reject(failure);
    });
  });
  void done.catch(() => {});
  return { supervisor, agent, close: () => (supervisor.stdio[3] as Writable).end(), done };
}
