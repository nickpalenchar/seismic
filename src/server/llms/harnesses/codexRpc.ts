


import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { messageOf } from '../../../core/text';
import { OWN_GROUP } from '../../spawn';
import { AgentProcesses, onceClosed, tolerateTimeouts, untilIdentified } from './processes';
import { sessionRegistry } from './sessionRegistry';


const running = new Map<() => void, { done: Promise<void>; force: () => Promise<void> }>();
/** Has `endSessionsHere` end a session as Seismic stops; returns what takes it off again. */
export function endAtShutdown(close: () => void, entry: { done: Promise<void>; force: () => Promise<void> }) {
  running.set(close, entry);
  return () => { running.delete(close); };
}
/** Ordinary shutdown waits for escalation; an explicit force waits only for its signals to go out. */
export async function endSessionsHere(force = false) {
  const active = [...running];
  if (force) await Promise.allSettled(active.map(([, entry]) => entry.force()));
  else {
    for (const [close] of active) close();
    await Promise.allSettled(active.map(([, entry]) => entry.done));
  }
}


const observers = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;
export function observeEveryTick(observe: () => void) {
  observers.add(observe);
  if (!ticker) {
    ticker = setInterval(() => { for (const o of observers) o(); }, 500);
    ticker.unref?.();
  }
  return () => {
    observers.delete(observe);
    if (!observers.size && ticker) { clearInterval(ticker); ticker = undefined; }
  };
}

export interface CodexHandlers {
  notification(method: string, params: Record<string, unknown>): void;
  request(method: string, params: Record<string, unknown>, requestId?: string | number): Promise<unknown>;
}

export interface CodexConnection {
  
  readonly pid?: number;
  request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
  notify(method: string, params: Record<string, unknown>): void;
  close(): void;
  
  trackProcesses?(pids: number[]): Promise<void>;
  
  done: Promise<void>;
}

export class CodexRpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'CodexRpcError';
  }
}

const envelope = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

/** An argv override is for contract tests; the runtime uses the installed CLI (or SEISMIC_CODEX). */
export function codexConnection(
  options: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number;  label?: string },
  handlers: CodexHandlers,
): CodexConnection {
  const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: OWN_GROUP });
  const terminals = child.pid ? new AgentProcesses(child.pid) : undefined;
  
  const record = terminals ? sessionRegistry()?.begin(options.label ?? 'Codex session', options.cwd) : undefined;
  const publish = () => {
    const identities = terminals!.observed();
    
    void record?.then((generation) => generation?.publish(identities)).catch((error: unknown) => {
      fail(new Error(`Session processes could not be put on record: ${messageOf(error)}`));
    });
  };
  if (terminals && record) { terminals.onChange = publish; publish(); }
  
  const observed = tolerateTimeouts();
  
  
  
  let unobserved = false;
  const watch = (operation: Promise<void>) => observed(operation).catch((error: unknown) => { if (terminals?.observed().length) unobserved = true; throw error; });
  /** The session's processes have ended, or the attempt failed and the record stays for a sweep. */
  const settleRecord = async (ended: boolean) => {
    const generation = await record;
    if (ended && !unobserved) await generation?.finish(); else await generation?.abandon();
  };
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 0;
  let closing = false;
  
  
  let exited = false;
  let failure: Error | undefined;
  let stderr = '';
  let buffer = '';
  let terminate: ReturnType<typeof setTimeout> | undefined;
  let kill: ReturnType<typeof setTimeout> | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  
  void done.catch(() => {});
  const decoder = new StringDecoder('utf8');

  function signal(which: NodeJS.Signals) {
    if (exited) return;
    try {
      if (OWN_GROUP && child.pid) process.kill(-child.pid, which);
      else child.kill(which);
    } catch {  }
  }
  function rejectPending(error: Error) {
    for (const p of pending.values()) clearTimeout(p.timer), p.reject(error);
    pending.clear();
  }
  function close() {
    if (closing) return;
    
    
    if (terminals) void watch(terminals.track()).catch((error: unknown) => { if (terminals.observed().length) failure ??= new Error(messageOf(error)); });
    closing = true;
    rejectPending(new Error('Codex app-server connection closed'));
    
    child.stdin.end();
    terminate = setTimeout(() => signal('SIGTERM'), 1000);
    kill = setTimeout(() => signal('SIGKILL'), 2000);
  }
  function fail(error: Error) {
    if (closing) return;
    failure = error;
    rejectPending(error);
    close();
  }
  function write(message: unknown) {
    if (closing) throw new Error('Codex app-server connection closed');
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => { if (error) fail(error); });
  }
  function receive(line: string) {
    const m = envelope.parse(JSON.parse(line));
    if (m.method) {
      if (m.id === undefined) handlers.notification(m.method, m.params ?? {});
      else {
        const id = m.id;
        
        void handlers.request(m.method, m.params ?? {}, id).then(
          (result) => { if (!closing) write({ id, result }); },
          (error: unknown) => { if (!closing) write({ id, error: { code: error instanceof CodexRpcError ? error.code : -32603, message: messageOf(error) } }); },
        ).catch((error: unknown) => fail(new Error(messageOf(error))));
      }
    } else if (typeof m.id === 'number') {
      const p = pending.get(m.id);
      if (!p) return; 
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new CodexRpcError(m.error.code, m.error.message));
      else if ('result' in m) p.resolve(m.result);
      else p.reject(new Error('Codex app-server reply has neither result nor error'));
    } else throw new Error('Invalid Codex app-server message');
  }
  child.stdout.on('data', (chunk: Buffer) => {
    if (closing) return;
    buffer += decoder.write(chunk);
    try {
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.length > 16 * 1024 * 1024) throw new Error('Codex app-server message too large');
        if (line.trim()) receive(line);
      }
      if (buffer.length > 16 * 1024 * 1024) throw new Error('Codex app-server message too large');
    } catch (error) { fail(new Error(`Invalid Codex app-server output: ${messageOf(error)}`)); }
  });
  child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr = (stderr + text).slice(-2000); });
  child.stdout.on('error', (error) => fail(error));
  child.stderr.on('error', (error) => fail(error));
  child.stdin.on('error', (error) => fail(error));
  child.on('error', (error) => fail(error));
  
  
  
  let observing = false;
  const stopObserving = observeEveryTick(() => {
    if (observing || !terminals) return;
    observing = true;
    watch(terminals.track()).catch((error: unknown) => fail(new Error(messageOf(error)))).finally(() => { observing = false; });
  });
  child.on('exit', (code, exitSignal) => {
    stopObserving();
    if (!closing) fail(new Error(`Codex app-server exited (${exitSignal ?? code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    
    void terminals?.kill().catch((error: unknown) => { failure ??= new Error(messageOf(error)); });
    
    
    if (OWN_GROUP && child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {  }
    exited = true;
    
    clearTimeout(terminate);
    clearTimeout(kill);
  });
  const unregister = endAtShutdown(close, { done, force: async () => {
    close();
    await terminals?.kill().catch((error: unknown) => { failure ??= new Error(messageOf(error)); });
    signal('SIGKILL');
  } });
  onceClosed(child, (code, exitSignal) => {
    stopObserving();
    clearTimeout(terminate);
    clearTimeout(kill);
    if (!closing) failure = new Error(`Codex app-server exited (${exitSignal ?? code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
    closing = true;
    rejectPending(failure ?? new Error('Codex app-server connection closed'));
    
    void (async () => {
      let ended = true;
      try { await terminals?.kill(); } catch (error) { ended = false; failure ??= new Error(messageOf(error)); }
      try { await settleRecord(ended); } catch (error) { failure ??= new Error(messageOf(error)); }
      unregister();
      if (failure) rejectDone(failure);
      else resolveDone();
    })();
  });
  
  
  const ready = terminals ? untilIdentified(terminals, watch).then(async () => {
    const generation = await record;
    await generation?.publish(terminals.observed());
  }) : Promise.resolve();
  void ready.catch((error: unknown) => fail(new Error(messageOf(error))));
  return {
    pid: child.pid,
    trackProcesses: async (pids) => { if (terminals) await watch(terminals.track(pids)); },
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      try { await ready; } catch (error) { throw closing ? failure ?? new Error('Codex app-server connection closed') : error; }
      return new Promise<T>((resolve, reject) => {
        if (closing) return reject(failure ?? new Error('Codex app-server connection closed'));
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          
          const error = new Error(`Codex app-server ${method} timed out`);
          reject(error);
          fail(error);
        }, options.timeoutMs ?? 30_000);
        pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
        try { write({ id, method, params }); }
        catch (error) { fail(new Error(messageOf(error))); }
      });
    },
    notify: (method, params) => write({ method, params }),
    close,
    done,
  };
}
