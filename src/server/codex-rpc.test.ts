import { expect, test } from 'bun:test';
import { testProcessCode } from '../test-process';
import { tmpdir } from 'node:os';
import { codexConnection, CodexRpcError, type CodexHandlers } from './codex-rpc';

const handlers: CodexHandlers = { notification: () => {}, request: async () => { throw new CodexRpcError(-32601, 'unsupported'); } };
const preamble = `import {createInterface} from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify(m)+'\\n');
const lines = createInterface({input:process.stdin});
`;
function connection(code: string, overrides: Partial<CodexHandlers> = {}, timeoutMs = 1000) {
  return codexConnection({ command: process.execPath, args: ['-e', testProcessCode(preamble + code)], cwd: tmpdir(), env: process.env, timeoutMs }, { ...handlers, ...overrides });
}

test('stdio correlates concurrent replies out of order and preserves split UTF-8 notifications', async () => {
  const notifications: unknown[] = [];
  const c = connection(`
const requests=[];
lines.on('line', line => {
 const m=JSON.parse(line); requests.push(m);
 if(requests.length === 2) {
  for(const r of requests.reverse()) send({id:r.id,result:{method:r.method}});
  const bytes=Buffer.from(JSON.stringify({method:'delta',params:{text:'Grüße 🌸'}})+'\\n');
  for(const byte of bytes) process.stdout.write(Buffer.from([byte]));
 }
});`, { notification: (method, params) => notifications.push({ method, params }) });
  try {
    expect(await Promise.all([c.request('one', {}), c.request('two', {})])).toEqual([{ method: 'one' }, { method: 'two' }]);
    const deadline = Date.now() + 1000;
    while (!notifications.length && Date.now() < deadline) await Bun.sleep(1);
    expect(notifications).toEqual([{ method: 'delta', params: { text: 'Grüße 🌸' } }]);
  } finally { c.close(); await c.done; }
});

test('server requests get responses without blocking other protocol traffic; unknown requests get errors', async () => {
  const c = connection(`
lines.on('line', line => {
 const m=JSON.parse(line);
 if(m.method === 'begin') { send({id:'server-call',method:'unknown',params:{}}); send({id:m.id,result:'accepted'}); }
 else if(m.id === 'server-call') send({method:'response-seen',params:m});
});`, { notification: (_method, params) => { response = params; } });
  let response: Record<string, unknown> | undefined;
  try {
    expect(await c.request<string>('begin', {})).toBe('accepted');
    const deadline = Date.now() + 1000;
    while (!response && Date.now() < deadline) await Bun.sleep(1);
    expect(response).toEqual({ id: 'server-call', error: { code: -32601, message: 'unsupported' } });
  } finally { c.close(); await c.done; }
});

test('server error retains its numeric code', async () => {
  const c = connection(`lines.on('line', line => send({id:JSON.parse(line).id,error:{code:-32602,message:'no active turn'}}));`);
  try {
    try { await c.request('turn/steer', {}); throw new Error('expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(CodexRpcError); expect((error as CodexRpcError).code).toBe(-32602); }
  } finally { c.close(); await c.done; }
});

test('a timeout fails the connection: a mutating request with unknown outcome cannot be retried', async () => {
  const c = connection(`lines.on('line', () => {});`, {}, 50);
  await expect(c.request('turn/start', {})).rejects.toThrow('turn/start timed out');
  await expect(c.request('turn/start', {})).rejects.toThrow('timed out');
  await expect(c.done).rejects.toThrow('timed out');
});

test('unexpected process exit and malformed stdout reject all in-flight RPCs', async () => {
  for (const code of [
    `lines.on('line', () => {process.stderr.write('probe failure'); process.exit(7);});`,
    `lines.on('line', () => process.stdout.write('not JSON\\n'));`,
  ]) {
    const c = connection(code);
    const results = await Promise.allSettled([c.request('a', {}), c.request('b', {}), c.done]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    const messages = results.map((r) => r.status === 'rejected' ? String(r.reason) : '');
    expect(messages.every((m) => m.includes(code.includes('probe failure') ? 'probe failure' : 'Invalid Codex app-server output'))).toBe(true);
  }
});

test('intentional shutdown rejects pending work, waits for process exit, and is idempotent', async () => {
  const c = connection(`lines.on('line', () => {});`);
  const pending = c.request('waiting', {});
  c.close();
  c.close();
  await expect(pending).rejects.toThrow('connection closed');
  await c.done;
});

test.skipIf(process.platform === 'win32')('parent exit kills its remaining process group, including commands holding stdout open', async () => {
  for (const stdio of ['ignore', 'inherit']) {
    const c = connection(`
const {spawn}=await import('node:child_process');
lines.on('line', line => {
 const child=spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{stdio:${JSON.stringify(stdio)}});
 send({id:JSON.parse(line).id,result:child.pid});
 setTimeout(()=>process.exit(7),50);
});`);
    const pid = await c.request<number>('spawn', {});
    try {
      await expect(c.done).rejects.toThrow('exited (7)');
      const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
      const deadline = Date.now() + 1000;
      while (alive() && Date.now() < deadline) await Bun.sleep(10);
      expect(alive()).toBe(false);
    } finally { try { process.kill(pid, 'SIGKILL'); } catch { /* already stopped */ } }
  }
});

test('missing executable is a normal startup failure, not an unhandled process error', async () => {
  const c = codexConnection({ command: '/nonexistent-obeya-codex-probe', args: [], cwd: tmpdir(), env: process.env }, handlers);
  await expect(c.request('initialize', {})).rejects.toThrow();
  await expect(c.done).rejects.toThrow();
});
