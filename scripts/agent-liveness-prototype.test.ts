import { expect, test } from 'bun:test';
import { testProcessCode } from '../src/test-process';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { inspectGeneration } from './agent-registry-prototype';
import { superviseAgent } from './agent-liveness-owner';

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('prototype timed out'); await Bun.sleep(20); }
}
function numberAt(path: string) { try { return Number(readFileSync(path, 'utf8')); } catch { return 0; } }
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function kill(pid: number) { if (pid > 1) try { process.kill(pid, 'SIGKILL'); } catch {} }

test.skipIf(process.platform === 'win32')('liveness EOF stops an observed detached descendant without touching a canary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-liveness-prototype-'));
  const pidFile = join(dir, 'pid');
  const beatFile = join(dir, 'beat');
  const worker = testProcessCode(`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
const c=spawn(process.execPath,['-e',${JSON.stringify(testProcessCode(`import {writeFileSync} from 'node:fs';let n=0;setInterval(()=>writeFileSync(${JSON.stringify(beatFile)},String(++n)),25);`))}],{detached:true,stdio:'ignore'});
writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`);
  const canary = spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' });
  const supervisor = spawn(process.execPath, [join(import.meta.dir, 'agent-liveness-prototype.ts'), '--', process.execPath, '-e', worker], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  let stderr = '';
  supervisor.stderr!.on('data', (chunk) => stderr += chunk);
  let pid = 0;
  try {
    await until(() => { pid = numberAt(pidFile); return pid > 1 && numberAt(beatFile) > 2; });
    await Bun.sleep(250); // let the supervisor observe the separately grouped child
    expect(alive(pid)).toBe(true);
    const exited = new Promise<void>((resolve) => supervisor.once('close', () => resolve()));
    (supervisor.stdio[3] as Writable).end();
    await exited;
    await until(() => !alive(pid));
    expect(alive(canary.pid!)).toBe(true);
    expect(stderr).toBe('');
  } finally {
    supervisor.kill('SIGKILL'); kill(pid); kill(canary.pid ?? 0);
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(process.platform === 'win32')('an agent that exits at once does not leave a same-group child behind', async () => {
  // Before the supervisor's first snapshot sees it: only the agent's group still reaches it.
  const dir = mkdtempSync(join(tmpdir(), 'obeya-liveness-fast-exit-'));
  const pidFile = join(dir, 'pid');
  const worker = testProcessCode(`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
const c=spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{stdio:'ignore'});c.unref();
writeFileSync(${JSON.stringify(pidFile)},String(c.pid));process.exit(0);`);
  const canary = spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' });
  const supervisor = spawn(process.execPath, [join(import.meta.dir, 'agent-liveness-prototype.ts'), '--', process.execPath, '-e', worker], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  let stderr = '';
  supervisor.stderr!.on('data', (chunk) => stderr += chunk);
  try {
    await new Promise<void>((resolve) => supervisor.once('close', () => resolve()));
    expect(numberAt(pidFile)).toBeGreaterThan(1);
    await until(() => !alive(numberAt(pidFile)));
    expect(alive(canary.pid!)).toBe(true);
    expect(stderr).toBe('');
  } finally {
    supervisor.kill('SIGKILL'); kill(numberAt(pidFile)); kill(canary.pid ?? 0);
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(process.platform === 'win32')('a killed supervisor leaves its caller to stop the agent holding its pipes, and what it reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-liveness-sigkill-'));
  const agentFile = join(dir, 'agent');
  const leafFile = join(dir, 'leaf');
  const worker = testProcessCode(`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(agentFile)},String(process.pid));
const c=spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{detached:true,stdio:'ignore'});
writeFileSync(${JSON.stringify(leafFile)},String(c.pid));process.stdin.resume();setInterval(()=>{},1000);`);
  const canary = spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' });
  const s = superviseAgent([process.execPath, '-e', worker], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdoutClosed = false;
  s.supervisor.stdout!.on('close', () => stdoutClosed = true).resume();
  s.supervisor.stderr!.resume();
  let agentPid = 0, leafPid = 0;
  try {
    const agent = await s.agent;
    await until(() => { agentPid = numberAt(agentFile); leafPid = numberAt(leafFile); return agentPid > 1 && leafPid > 1; });
    // the transport's process identity is the agent's own, not the supervisor's
    expect(agent.pid).toBe(agentPid);
    expect(agent.pid).not.toBe(s.supervisor.pid);
    await Bun.sleep(300); // let the supervisor observe and report the separately grouped leaf
    let heldAtExit = false;
    s.supervisor.once('exit', () => heldAtExit = !stdoutClosed);
    s.supervisor.kill('SIGKILL');
    await s.done;
    expect(heldAtExit).toBe(true); // waiting for the pipes to close would have waited forever
    await until(() => !alive(agentPid) && !alive(leafPid));
    expect(alive(canary.pid!)).toBe(true);
  } finally {
    s.supervisor.kill('SIGKILL'); kill(agentPid || numberAt(agentFile)); kill(leafPid || numberAt(leafFile)); kill(canary.pid ?? 0);
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(process.platform === 'win32')('neither the liveness pipe nor the report pipe reaches the agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-liveness-fds-'));
  const result = join(dir, 'fds');
  const s = superviseAgent(['/bin/sh', '-c', `for f in 3 4; do [ -e /dev/fd/$f ] && printf "$f "; done > ${JSON.stringify(result)}; echo done >> ${JSON.stringify(result)}`]);
  try {
    await s.done;
    expect(readFileSync(result, 'utf8').trim()).toBe('done');
  } finally {
    s.supervisor.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(process.platform === 'win32')('ending one liveness pipe stops only that supervisor\'s agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-liveness-two-'));
  const files = [join(dir, 'a'), join(dir, 'b')];
  const sessions = files.map((file) => superviseAgent([process.execPath, '-e', testProcessCode(`require('node:fs').writeFileSync(${JSON.stringify(file)},String(process.pid));setInterval(()=>{},1000);`)]));
  try {
    await until(() => files.every((file) => numberAt(file) > 1));
    sessions[0]!.close();
    await sessions[0]!.done;
    await until(() => !alive(numberAt(files[0]!)));
    expect(alive(numberAt(files[1]!))).toBe(true);
    sessions[1]!.close();
    await sessions[1]!.done;
    expect(alive(numberAt(files[1]!))).toBe(false);
  } finally {
    for (const s of sessions) s.supervisor.kill('SIGKILL');
    for (const file of files) kill(numberAt(file));
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(process.platform !== 'linux')('agent code starts only after its identity is in the registry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-gate-registry-'));
  const result = join(dir, 'result');
  const worker = testProcessCode(`import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
const file=readdirSync(${JSON.stringify(dir)}).find(n=>n.endsWith('.json'));
const record=JSON.parse(readFileSync(${JSON.stringify(dir)}+'/'+file,'utf8'));
writeFileSync(${JSON.stringify(result)},String(record.processes.some(p=>p.pid===process.pid)));
setInterval(()=>{},1000);`);
  const supervisor = spawn(process.execPath, [join(import.meta.dir, 'agent-liveness-prototype.ts'), '--', process.execPath, '-e', worker], {
    env: { ...process.env, SEISMIC_PROTO_REGISTRY: dir }, stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  });
  try {
    await until(() => { try { return !!readFileSync(result, 'utf8'); } catch { return false; } });
    expect(readFileSync(result, 'utf8')).toBe('true');
    const exited = new Promise<void>((resolve) => supervisor.once('close', () => resolve()));
    (supervisor.stdio[3] as Writable).end();
    await exited;
  } finally {
    supervisor.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(process.platform !== 'linux')('a killed supervisor leaves a report-only record of its observed processes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-liveness-registry-'));
  const rootFile = join(dir, 'root');
  const childFile = join(dir, 'child');
  const worker = testProcessCode(`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(rootFile)},String(process.pid));
const c=spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{detached:true,stdio:'ignore'});
writeFileSync(${JSON.stringify(childFile)},String(c.pid));setInterval(()=>{},1000);`);
  const canary = spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' });
  const supervisor = spawn(process.execPath, [join(import.meta.dir, 'agent-liveness-prototype.ts'), '--', process.execPath, '-e', worker], {
    env: { ...process.env, SEISMIC_PROTO_REGISTRY: dir }, stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
  });
  let rootPid = 0, childPid = 0, id = '';
  try {
    await until(() => {
      rootPid = numberAt(rootFile); childPid = numberAt(childFile);
      const file = readdirSync(dir).find((name) => name.endsWith('.json'));
      if (!file || !rootPid || !childPid) return false;
      id = file.slice(0, -5);
      try {
        const record = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { processes: { pid: number }[] };
        return record.processes.some((p) => p.pid === rootPid) && record.processes.some((p) => p.pid === childPid);
      } catch { return false; }
    });
    expect(inspectGeneration(dir, id).state).toBe('unknown'); // supervisor holds lease
    const exited = new Promise<void>((resolve) => supervisor.once('exit', () => resolve()));
    supervisor.kill('SIGKILL'); await exited;
    const report = inspectGeneration(dir, id);
    expect(report.state).toBe('inspectable');
    if (report.state === 'inspectable') expect(report.processes).toEqual(expect.arrayContaining([
      { pid: rootPid, state: 'match' }, { pid: childPid, state: 'match' },
    ]));
    expect(alive(canary.pid!)).toBe(true);
  } finally {
    supervisor.kill('SIGKILL'); kill(rootPid || numberAt(rootFile)); kill(childPid || numberAt(childFile)); kill(canary.pid ?? 0);
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);
