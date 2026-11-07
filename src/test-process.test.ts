import { expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testProcessCode } from './test-process';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('test helper did not settle');
    await Bun.sleep(20);
  }
}
const exited = (p: ChildProcess) => new Promise((resolve) => p.once('exit', resolve));

test('SIGKILL of a test runner ends its canary, detached child, and orphaned grandchild', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-test-owner-'));
  const ready = join(dir, 'pids.json');
  const beat = join(dir, 'heartbeat');
  const marker = join(dir, 'should-not-run');
  const lateCode = join(dir, 'late-code');
  const fixture = join(dir, 'owner.test.ts');
  // Even this nested runner is disposable if the outer suite is killed during this regression.
  writeFileSync(fixture, testProcessCode(`
    import { test } from 'bun:test';
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { testProcessCode } from ${JSON.stringify(join(import.meta.dir, 'test-process.ts'))};
    writeFileSync(${JSON.stringify(lateCode)}, testProcessCode(${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`)}));
    test('holds helpers without finally cleanup', async () => {
      const pids = [];
      const launch = (code) => {
        const p = spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore' });
        p.unref(); pids.push(p.pid);
        writeFileSync(${JSON.stringify(ready)}, JSON.stringify(pids));
        return p;
      };
      launch(testProcessCode());
      const leaf = testProcessCode(
        "import {writeFileSync} from 'node:fs';process.kill=()=>true;process.stdin.resume();process.on('SIGTERM',()=>{});setInterval(()=>writeFileSync(" +
        ${JSON.stringify(JSON.stringify(beat))} + ",String(Date.now())),25);");
      launch(testProcessCode(
        "import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';" +
        "const leaf=spawn(process.execPath,['-e'," + JSON.stringify(leaf) + "],{detached:true,stdio:'ignore'});" +
        "writeFileSync(" + ${JSON.stringify(JSON.stringify(join(dir, 'leaf')))} + ",String(leaf.pid));setInterval(()=>{},1000);"));
      await new Promise(() => {});
    }, 60000);
  `));
  const runner = spawn(process.execPath, ['test', fixture], { stdio: 'ignore' });
  const runnerExit = exited(runner);
  let pids: number[] = [];
  try {
    await until(() => existsSync(beat));
    pids = [...JSON.parse(readFileSync(ready, 'utf8')), Number(readFileSync(join(dir, 'leaf'), 'utf8'))];
    expect(pids).toHaveLength(3);
    expect(pids.every(alive)).toBe(true);
    // The immediate parent can die while the test is still checking orphan recovery.
    process.kill(pids[1]!, 'SIGKILL');
    await until(() => !alive(pids[1]!));
    await Bun.sleep(250);
    expect(alive(pids[0]!) && alive(pids[2]!)).toBe(true);
    // The leaf's PID probe always succeeds, as it would for a zombie or a reused owner PID.
    runner.kill('SIGKILL');
    await runnerExit;
    await until(() => pids.every((pid) => !alive(pid)));
    // A helper scheduled before SIGKILL but only started afterwards exits before its body.
    const late = spawn(process.execPath, ['-e', readFileSync(lateCode, 'utf8')], { stdio: 'ignore' });
    await exited(late);
    expect(existsSync(marker)).toBe(false);
  } finally {
    runner.kill('SIGKILL');
    try { pids.push(...JSON.parse(readFileSync(ready, 'utf8'))); } catch {}
    try { pids.push(Number(readFileSync(join(dir, 'leaf'), 'utf8'))); } catch {}
    for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);

test('the owner check does not keep a finite helper alive', async () => {
  const child = spawn(process.execPath, ['-e', testProcessCode('process.exitCode = 7;')], { stdio: 'ignore' });
  await exited(child);
  expect(child.exitCode).toBe(7);
});

test('a late helper rejects an unrelated listener on a reused port', async () => {
  let connected = 0;
  const unrelated = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: {
    open(socket) { connected++; socket.write('!'.repeat(36)); },
    data() {},
  } });
  try {
    const code = testProcessCode('process.exit(9);').replace(/port: \d+/, `port: ${unrelated.port}`);
    const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
    await exited(child);
    expect(connected).toBe(1);
    expect(child.exitCode).toBe(0);
  } finally { unrelated.stop(true); }
});

test('lifetime pipes do not keep a finished test runner alive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-test-finished-'));
  const ready = join(dir, 'pid');
  const fixture = join(dir, 'finished.test.ts');
  writeFileSync(fixture, testProcessCode(`
    import { test } from 'bun:test';
    import { spawn } from 'node:child_process';
    import { existsSync } from 'node:fs';
    import { testProcessCode } from ${JSON.stringify(join(import.meta.dir, 'test-process.ts'))};
    test('finishes without cleaning up its helper', async () => {
      const child = spawn(process.execPath, ['-e', testProcessCode(${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid));setInterval(()=>{},1000);`)})], { detached: true, stdio: 'ignore' });
      child.unref();
      while (!existsSync(${JSON.stringify(ready)})) await Bun.sleep(10);
    });
  `));
  const runner = spawn(process.execPath, ['test', fixture], { stdio: 'ignore' });
  let pid = 0;
  try {
    await until(() => existsSync(ready));
    pid = Number(readFileSync(ready, 'utf8'));
    await until(() => runner.exitCode !== null);
    expect(runner.exitCode).toBe(0);
    await until(() => !alive(pid));
  } finally {
    runner.kill('SIGKILL');
    if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
