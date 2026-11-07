// Experimental caller side of `agent-liveness-prototype.ts`, not used by Seismic. It holds the
// liveness pipe (the supervisor cleans up when this process dies) and adopts every identity the
// supervisor reports, so that when the supervisor dies instead, this side signals what it saw:
// the agent itself (reparented, possibly still holding this process's pipes) and its descendants.
// Both sides sample; neither closes the window before a process is first observed.
import { spawn, type ChildProcess, type StdioNull, type StdioPipe } from 'node:child_process';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { AgentProcesses } from '../src/server/agent-processes';

export interface Identity { pid: number; born: string }

export interface Supervised {
  /** The supervisor; the agent inherits its stdio 0–2, so these are the agent's streams. */
  supervisor: ChildProcess;
  /** The agent's own identity, distinct from the supervisor's, reported before its code runs. */
  agent: Promise<Identity>;
  /** Ends the liveness pipe: the supervisor kills the agent and what it observed, then exits. */
  close(): void;
  /** Settles once the supervisor has exited and every identity it reported has been signalled; rejects if that is not known. */
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
  // Each report is adopted at once: while the process still has that identity, it stays owed.
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
    // `exit`, not `close`: the agent may still hold the supervisor's stdio after the supervisor died.
    supervisor.once('exit', async () => {
      // Only the supervisor writes reports; its death ends them. Read what it wrote before dying.
      // A stream still open then may hold identities that would arrive too late to be signalled.
      const closed = await Promise.race([reportsClosed.then(() => true), Bun.sleep(1000).then(() => false)]);
      if (!closed) { failure ??= new Error('The supervisor\'s report pipe stayed open after its exit'); reports.destroy(); }
      if (first) rejectAgent(new Error('The supervisor reported no agent'));
      // Queued after every adoption, so it signals all that were reported.
      await tracker?.kill().catch((error: unknown) => { failure ??= error; });
      (supervisor.stdio[3] as Writable).destroy();
      if (failure === undefined) resolve(); else reject(failure);
    });
  });
  void done.catch(() => {});
  return { supervisor, agent, close: () => (supervisor.stdio[3] as Writable).end(), done };
}
