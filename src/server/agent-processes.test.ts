import { expect, test } from 'bun:test';
import { testProcessCode } from '../test-process';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexConnection } from './codex-rpc';
import { AgentProcesses, linuxProcessStat, processes, processesAsync, sharedSnapshot, tolerateTimeouts } from './agent-processes';

const handlers = { notification() {}, request: async () => ({}) };
const beat = (file: string) => { try { return Number(readFileSync(file, 'utf8')); } catch { return 0; } };
async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error('Process cleanup probe timed out'); await Bun.sleep(10); }
}
function kill(pid: number | undefined) { if (pid) try { process.kill(pid, 'SIGKILL'); } catch {} }

test('Linux stat parsing handles nested parentheses and uses exact process start ticks', () => {
  const stat = '42 (name ) with ( spaces) S 10 42 42 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 987654321 0';
  expect(linuxProcessStat(stat)).toEqual({ pid: 42, parent: 10, group: 42, born: '987654321' });
  expect(linuxProcessStat('42 (truncated) S 10')).toBeUndefined();
});

test('the snapshot leaves the event loop free and sees the same identities as the blocking one', async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    const own = (await processesAsync(new Set([process.pid]))).find((p) => p.pid === process.pid);
    expect(ticks).toBeGreaterThan(0);
    expect(own).toEqual(processes(new Set([process.pid])).find((p) => p.pid === process.pid)!);
  } finally { clearInterval(timer); }
});

test('a kill waits for the snapshot of a track queued before it, and ends what that track found', async () => {
  const root = { pid: 90001, parent: process.pid, group: 90001, born: 'root' };
  const child = { pid: 90002, parent: root.pid, group: 90002, born: 'child' };
  let release!: () => void;
  const slow = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const tracker = new AgentProcesses(root.pid, async () => { if (++calls === 2) await slow; return [root, child]; });
  const tracked = tracker.track();
  const killed = tracker.kill();
  await Bun.sleep(20);
  expect(calls).toBe(2); // the kill has not taken its snapshot yet
  const spy = spyOnKill();
  try {
    release();
    await tracked;
    await killed;
    expect(spy.calls).toEqual([[-90002, 'SIGKILL']]);
  } finally { spy.restore(); }
});

const timeout = () => Object.assign(new Error('Agent process snapshot timed out'), { code: 'ETIMEDOUT' });

test('sessions that observe on the same tick share one snapshot; one asked during it gets the next', async () => {
  const rows = [{ pid: 90001, parent: process.pid, group: 90001, born: 'a' }, { pid: 90002, parent: process.pid, group: 90002, born: 'b' }];
  const asked: number[][] = [];
  let release!: () => void;
  const share = sharedSnapshot(async (required) => {
    asked.push([...required].sort());
    if (asked.length === 1) await new Promise<void>((resolve) => { release = resolve; });
    return { rows, denied: new Map([[90003, new Error('denied')]]) };
  });
  const a = new AgentProcesses(90001, share);
  const b = new AgentProcesses(90002, share);
  const first = Promise.all([a.track(), b.track()]);
  await Bun.sleep(20);
  expect(asked).toEqual([[90001, 90002]]);
  const late = share(new Set([90003]));
  release();
  await first;
  expect(a.observed()).toEqual([{ pid: 90001, born: 'a' }]);
  // The roots were established in one snapshot; both tracks and the late caller share the next,
  // in which only the caller that needs the unreadable process is refused.
  await expect(late).rejects.toThrow('denied');
  expect(asked).toEqual([[90001, 90002], [90001, 90002, 90003]]);
});

test('a timed-out snapshot leaves the root to be established by the next track', async () => {
  const root = { pid: 90001, parent: process.pid, group: 90001, born: 'root' };
  let calls = 0;
  const tracker = new AgentProcesses(root.pid, () => { if (++calls === 1) throw timeout(); return [root]; });
  await tracker.track();
  expect(tracker.observed()).toEqual([{ pid: root.pid, born: 'root' }]);
});

test('snapshot timeouts are skipped until they last the whole window; other failures are not', async () => {
  let now = 0;
  const observed = tolerateTimeouts(30_000, () => now);
  await observed(Promise.reject(timeout()));
  now = 20_000;
  await observed(Promise.reject(timeout()));
  now = 30_000;
  await expect(observed(Promise.reject(timeout()))).rejects.toThrow('timed out');
  await observed(Promise.resolve());
  await observed(Promise.reject(timeout())); // a snapshot that succeeded starts the window afresh
  await expect(observed(Promise.reject(new Error('Cannot inspect agent process ownership')))).rejects.toThrow('Cannot inspect');
});

test('a missing initial root is reported, never trusted later', async () => {
  const tracker = new AgentProcesses(90001, () => []);
  await expect(tracker.track()).rejects.toThrow('Cannot establish agent process ownership');
});

test('observed identities retain original births without exposing mutable tracker state', async () => {
  const root = { pid: 90001, parent: process.pid, group: 90001, born: 'root' };
  const child = { pid: 90002, parent: root.pid, group: 90002, born: 'child' };
  let rows = [root, child];
  const tracker = new AgentProcesses(root.pid, () => rows);
  await tracker.track();
  rows = [root, { ...child, parent: process.pid, born: 'replacement' }];
  await tracker.track();
  const observed = tracker.observed();
  expect(observed).toEqual([{ pid: root.pid, born: 'root' }, { pid: child.pid, born: 'child' }]);
  observed[1]!.born = 'changed';
  expect(tracker.observed()[1]!.born).toBe('child');
});

test('a reported descendant retains its verified intermediate ancestors', async () => {
  const root = { pid: 90001, parent: process.pid, group: 90001, born: 'root' };
  const intermediate = { pid: 90002, parent: root.pid, group: 90002, born: 'intermediate' };
  const leaf = { pid: 90003, parent: intermediate.pid, group: 90003, born: 'leaf' };
  const unrelated = { pid: 90004, parent: process.pid, group: 90004, born: 'unrelated' };
  const tracker = new AgentProcesses(root.pid, () => [root, intermediate, leaf, unrelated]);
  await tracker.track([leaf.pid, unrelated.pid]);
  expect(tracker.observed()).toEqual([
    { pid: root.pid, born: root.born },
    { pid: intermediate.pid, born: intermediate.born },
    { pid: leaf.pid, born: leaf.born },
  ]);
});

test('a supervisor\'s reported identities are adopted only while their creation identity holds', async () => {
  const supervisor = { pid: 90001, parent: process.pid, group: 90001, born: 'supervisor' };
  const agent = { pid: 90002, parent: 1, group: 90002, born: 'agent' }; // reparented: no ancestry left
  const reused = { pid: 90003, parent: 1, group: 90003, born: 'someone else' };
  const tracker = new AgentProcesses(supervisor.pid, () => [supervisor, agent, reused]);
  await tracker.adopt([{ pid: agent.pid, born: 'agent' }, { pid: reused.pid, born: 'leaf' }, { pid: supervisor.pid, born: 'supervisor' }]);
  expect(tracker.observed()).toEqual([{ pid: supervisor.pid, born: 'supervisor' }, { pid: agent.pid, born: 'agent' }]);
});

test('a reused app-server PID does not make an unrelated process its descendant', async () => {
  const root = { pid: 90001, parent: process.pid, group: 90001, born: 'original' };
  let rows = [root];
  const tracker = new AgentProcesses(root.pid, () => rows);
  rows = [{ ...root, born: 'replacement' }, { pid: 90002, parent: root.pid, group: 90002, born: 'child' }];
  await tracker.track();
  expect((tracker as unknown as { owned: Map<number, unknown> }).owned.size).toBe(0);
});

test.skipIf(process.platform === 'win32')('a reported leaf keeps its app-server attributable after supervisor death', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-ancestor-death-'));
  const appFile = join(dir, 'app');
  const leafFile = join(dir, 'leaf');
  const app = testProcessCode(`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(appFile)},String(process.pid));
const leaf=spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{detached:true,stdio:'ignore'});
writeFileSync(${JSON.stringify(leafFile)},String(leaf.pid));setInterval(()=>{},1000);`);
  const supervisorCode = testProcessCode(`import {spawn} from 'node:child_process';
spawn(process.execPath,['-e',${JSON.stringify(app)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`);
  const supervisor = spawn(process.execPath, ['-e', supervisorCode], { detached: true, stdio: 'ignore' });
  const canary = spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' });
  const tracker = new AgentProcesses(supervisor.pid!);
  let appPid = 0, leafPid = 0;
  const filePid = (file: string) => { try { return Number(readFileSync(file, 'utf8')); } catch { return 0; } };
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    await until(() => { appPid = filePid(appFile); leafPid = filePid(leafFile); return appPid > 1 && leafPid > 1; });
    await tracker.track([leafPid]);
    expect(tracker.observed().map((p) => p.pid)).toEqual([supervisor.pid!, appPid, leafPid]);
    const exited = new Promise<void>((resolve) => supervisor.once('exit', () => resolve()));
    supervisor.kill('SIGKILL');
    await exited;
    await tracker.kill();
    await until(() => !alive(appPid) && !alive(leafPid));
    expect(alive(canary.pid!)).toBe(true);
  } finally {
    supervisor.kill('SIGKILL'); kill(appPid || filePid(appFile)); kill(leafPid || filePid(leafFile)); kill(canary.pid);
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(process.platform === 'win32')('app-server death kills its separately grouped PTY, not an unrelated PID', async () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-pty-test-'));
  const file = join(root, 'heartbeat');
  const childCode = testProcessCode(`let n=0;const fs=await import('node:fs');setInterval(()=>fs.writeFileSync(${JSON.stringify(file)},String(++n)),25);`);
  const code = testProcessCode(`import {spawn} from 'node:child_process'; import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'ignore'});
createInterface({input:process.stdin}).on('line',line=>process.stdout.write(JSON.stringify({id:JSON.parse(line).id,result:child.pid})+'\\n'));
setInterval(()=>{},1000);`);
  const unrelated = spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' });
  const c = codexConnection({ command: process.execPath, args: ['-e', code], cwd: root, env: process.env }, handlers);
  let pid: number | undefined;
  try {
    pid = await c.request<number>('spawn', {});
    await until(() => beat(file) > 2);
    await c.trackProcesses!([pid, process.pid, unrelated.pid!]);
    process.kill(c.pid!, 'SIGKILL');
    await expect(c.done).rejects.toThrow('exited');
    await Bun.sleep(100);
    const stopped = beat(file);
    await Bun.sleep(150);
    expect(beat(file)).toBe(stopped);
    expect(process.kill(unrelated.pid!, 0)).toBe(true);
  } finally {
    c.close(); await c.done.catch(() => {});
    kill(pid); kill(unrelated.pid);
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === 'win32')('forced shutdown signals an observed detached child and does not wait for escalation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-force-test-'));
  const file = join(root, 'heartbeat');
  const code = testProcessCode(`import {writeFileSync} from 'node:fs';let n=0;process.on('SIGTERM',()=>{});setInterval(()=>writeFileSync(${JSON.stringify(file)},String(++n)),25);`);
  const server = testProcessCode(`import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['-e',${JSON.stringify(code)}],{detached:true,stdio:'ignore'});
createInterface({input:process.stdin}).on('line',line=>process.stdout.write(JSON.stringify({id:JSON.parse(line).id,result:child.pid})+'\\n'));
process.stdin.on('end',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
  const { endCodexHere } = await import('./codex-rpc');
  const canary = spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' });
  const c = codexConnection({ command: process.execPath, args: ['-e', server], cwd: root, env: process.env }, handlers);
  let pid: number | undefined;
  try {
    pid = await c.request<number>('spawn', {});
    await until(() => beat(file) > 2);
    await c.trackProcesses!([pid]);
    // A second stop can arrive after ordinary shutdown has already closed the session.
    c.close();
    const start = Date.now();
    await endCodexHere(true);
    expect(Date.now() - start).toBeLessThan(1000);
    await until(() => { try { process.kill(pid!, 0); return false; } catch { return true; } });
    expect(process.kill(canary.pid!, 0)).toBe(true);
  } finally {
    c.close(); await c.done.catch(() => {});
    kill(pid); kill(canary.pid);
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);

test('shutdown awaits escalation before exiting, including an EOF/TERM-ignoring subprocess', async () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-exit-test-'));
  const file = join(root, 'heartbeat');
  const code = testProcessCode(`import {writeFileSync} from 'node:fs';let n=0;process.stdin.resume();process.stdin.on('end',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>writeFileSync(${JSON.stringify(file)},String(++n)),25);`);
  const driver = testProcessCode(`import {codexConnection,endCodexHere} from ${JSON.stringify(join(import.meta.dir, 'codex-rpc.ts'))};
const c=codexConnection({command:process.execPath,args:['-e',${JSON.stringify(code)}],cwd:${JSON.stringify(root)},env:process.env},{notification(){},request:async()=>({})});
console.log(c.pid);await Bun.sleep(150);await endCodexHere();process.exit(0);`);
  const p = Bun.spawn([process.execPath, '-e', driver], { stdout: 'pipe', stderr: 'pipe' });
  let pid: number | undefined;
  try {
    const stdout = new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    pid = Number((await stdout).trim());
    expect(beat(file)).toBeGreaterThan(0);
    const stopped = beat(file);
    await Bun.sleep(100);
    expect(beat(file)).toBe(stopped);
  } finally { p.kill(); kill(pid); rmSync(root, { recursive: true, force: true }); }
}, 10_000);

function spyOnKill(refuse: (pid: number) => boolean = () => false) {
  const real = process.kill;
  const calls: [number, string | number | undefined][] = [];
  process.kill = ((pid: number, sig?: string | number) => {
    if (Math.abs(pid) >= 90000) {
      calls.push([pid, sig]);
      if (refuse(pid)) throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
      return true;
    }
    return real(pid, sig as NodeJS.Signals);
  }) as typeof process.kill;
  return { calls, restore: () => { process.kill = real; } };
}

test.skipIf(process.platform === 'win32')('a refused signal does not leave the other observed processes alive, and is retried later', async () => {
  const root = { pid: 90001, parent: process.pid, group: 90001, born: 'root' };
  const a = { pid: 90002, parent: root.pid, group: 90002, born: 'a' };
  const b = { pid: 90003, parent: root.pid, group: 90003, born: 'b' };
  const tracker = new AgentProcesses(root.pid, () => [root, a, b]);
  await tracker.track();
  const spy = spyOnKill((pid) => pid === -90003);
  try {
    await expect(tracker.kill()).rejects.toThrow('not permitted');
    expect(spy.calls.map(([pid]) => pid).sort()).toEqual([-90003, -90002].sort());
    // only the refused one is still owed a signal
    expect(tracker.observed().map((p) => p.pid)).toEqual([root.pid, b.pid]);
  } finally { spy.restore(); }
});

test.skipIf(process.platform === 'win32')('after the app-server has exited, its group number is signalled once and never again', async () => {
  const spy = spyOnKill();
  const real = process.kill;
  const c = codexConnection({ command: process.execPath, args: ['-e', testProcessCode(`process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`)], cwd: process.cwd(), env: process.env }, handlers);
  const group = -c.pid!;
  const seen: [number, unknown][] = [];
  process.kill = ((pid: number, sig?: string | number) => { if (pid === group) seen.push([pid, sig]); return real(pid, sig as NodeJS.Signals); }) as typeof process.kill;
  try {
    await Bun.sleep(100);
    c.close();
    await c.done;
    // the escalation timers (1 s, 2 s) must not fire at a group number that may be reused by now
    await Bun.sleep(2300);
    expect(seen).toEqual([[group, 'SIGKILL']]);
  } finally { process.kill = real; spy.restore(); }
}, 10_000);
