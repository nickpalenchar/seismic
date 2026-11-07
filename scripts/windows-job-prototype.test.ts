// Runs on Windows only (a desktop, or the windows-latest runner of .github/workflows/process-boundary.yml);
// skipped elsewhere, since Job Objects do not exist there.
import { afterEach, expect, test } from 'bun:test';
import { testProcessCode } from '../src/test-process';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJob, inJob, launchInJob, type Job } from './windows-job-prototype';

const windows = process.platform === 'win32';
const PROTOTYPE = JSON.stringify(join(import.meta.dir, 'windows-job-prototype.ts'));

async function until(check: () => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() > deadline) throw new Error('timed out'); await Bun.sleep(25); }
}
const read = (file: string) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const kill = (pid: number) => { if (pid > 0) try { process.kill(pid); } catch { /* gone */ } };
const scratch = () => mkdtempSync(join(tmpdir(), 'obeya-job-'));
const idle = () => spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore', windowsHide: true });
/** A bun process running `code`, its stdio ignored. */
const bunArgs = (code: string) => ['-e', testProcessCode(code)];

const started: Job[] = [];
afterEach(() => { for (const job of started.splice(0)) try { job.kill(); job.close(); } catch { /* reported by the test */ } });
async function launch(...args: Parameters<typeof launchInJob>) {
  const r = await launchInJob(...args);
  if (r.boundary === 'job') started.push(r.job);
  return r;
}

test.skipIf(!windows)('the agent is in its job from its first instruction', async () => {
  const dir = scratch();
  try {
    const name = `obeya-test-${randomUUID()}`;
    const r = await launch(process.execPath, bunArgs(`import { inJob } from ${PROTOTYPE}; require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'in'))}, String(inJob(${JSON.stringify(name)})));`), { name, stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.boundary !== 'job') throw new Error(r.reason);
    await new Promise((resolve) => r.child.exitCode !== null ? resolve(null) : r.child.once('exit', resolve));
    expect(read(join(dir, 'in'))).toBe('true');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!windows)('a second job of the same name is refused', () => {
  const { job } = createJob();
  started.push(job);
  expect(() => createJob(job.name)).toThrow('exists already');
});

test.skipIf(!windows)('ending the job stops a detached grandchild whose parent exited at once, and nothing else', async () => {
  const dir = scratch();
  const canary = idle();
  let grandchild = 0;
  try {
    const r = await launch(process.execPath, bunArgs(`
      const c = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(testProcessCode())}], { detached: true, stdio: 'ignore', windowsHide: true });
      require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'grandchild'))}, String(c.pid)); c.unref(); process.exit(0);`), { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.boundary !== 'job') throw new Error(r.reason);
    await until(() => (grandchild = Number(read(join(dir, 'grandchild')))) > 0);
    await new Promise((resolve) => r.child.exitCode !== null ? resolve(null) : r.child.once('exit', resolve));
    expect(r.job.members()).toContain(grandchild);
    r.job.kill();
    await until(() => !alive(grandchild) && r.job.active() === 0);
    expect(alive(canary.pid!)).toBe(true);
  } finally { kill(grandchild); canary.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!windows)("the caller's death ends the job's processes (kill on close)", async () => {
  const dir = scratch();
  const canary = idle();
  let agent = 0;
  let grandchild = 0;
  const caller = spawn(process.execPath, ['-e', testProcessCode(`
    import { launchInJob } from ${PROTOTYPE};
    // the path comes by the environment: no quoting of a Windows path in code within code
    const r = await launchInJob(process.execPath, ['-e', ${JSON.stringify(testProcessCode(`const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{detached:true,stdio:'ignore',windowsHide:true});require('node:fs').writeFileSync((process.env.SEISMIC_TEST_FILE ?? process.env.OBEYA_TEST_FILE),String(c.pid));setInterval(()=>{},1000);`))}], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (r.boundary !== 'job') { console.error(r.reason); process.exit(1); }
    console.log(r.child.pid);
    setInterval(() => {}, 1000);
  `)], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true, env: { ...process.env, SEISMIC_TEST_FILE: join(dir, 'grandchild') } });
  try {
    agent = Number(await new Promise<string>((resolve) => caller.stdout!.once('data', (chunk: Buffer) => resolve(chunk.toString()))));
    await until(() => (grandchild = Number(read(join(dir, 'grandchild')))) > 0);
    expect(alive(agent) && alive(grandchild)).toBe(true);
    caller.kill(); // TerminateProcess: no cleanup of its own runs
    await until(() => !alive(agent) && !alive(grandchild));
    expect(alive(canary.pid!)).toBe(true);
  } finally { caller.kill(); kill(agent); kill(grandchild); canary.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!windows)("the agent's exit leaves its app running in the job, for parking or the caller to end", async () => {
  const dir = scratch();
  let app = 0;
  try {
    const r = await launch(process.execPath, bunArgs(`
      const c = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(testProcessCode())}], { detached: true, stdio: 'ignore', windowsHide: true });
      require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'app'))}, String(c.pid)); c.unref(); process.exit(0);`), { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.boundary !== 'job') throw new Error(r.reason);
    await new Promise((resolve) => r.child.exitCode !== null ? resolve(null) : r.child.once('exit', resolve));
    app = Number(read(join(dir, 'app')));
    await Bun.sleep(300);
    expect(alive(app)).toBe(true);
    expect(r.job.active()).toBe(1);
    process.kill(app); // app.stop, run by Seismic outside the job
    await until(() => r.job.active() === 0);
  } finally { kill(app); rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!windows)('a job nested in an outer one: ending the inner leaves the outer, ending the outer ends both', async () => {
  const dir = scratch();
  let sessionAgent = 0;
  // a launcher in an outer job (as Seismic inside a terminal's or a CI runner's job) makes a session job
  const launcher = await launch(process.execPath, ['-e', testProcessCode(`
    import { launchInJob } from ${PROTOTYPE};
    const r = await launchInJob(process.execPath, ['-e', ${JSON.stringify(testProcessCode())}], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (r.boundary !== 'job') { console.error(r.reason); process.exit(1); }
    require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'session'))}, JSON.stringify({ name: r.job.name, agent: r.child.pid }));
    process.stdin.once('data', () => { r.job.kill(); require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'killed'))}, '1'); });
    setInterval(() => {}, 1000);
  `)], { stdio: ['pipe', 'ignore', 'inherit'], killOnClose: false });
  try {
    if (launcher.boundary !== 'job') throw new Error(launcher.reason);
    await until(() => read(join(dir, 'session')) !== '');
    const session = JSON.parse(read(join(dir, 'session'))) as { name: string; agent: number };
    sessionAgent = session.agent;
    expect(inJob(session.name, session.agent)).toBe(true);
    expect(inJob(launcher.job.name, session.agent)).toBe(true); // nested: in both
    launcher.child.stdin!.write('kill\n');
    await until(() => read(join(dir, 'killed')) === '1' && !alive(session.agent));
    expect(alive(launcher.child.pid!)).toBe(true);
    launcher.job.kill();
    await until(() => !alive(launcher.child.pid!));
  } finally { kill(sessionAgent); rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!windows)('a child created to break away stays in the job and ends with it', async () => {
  // CreateProcess with CREATE_BREAKAWAY_FROM_JOB; the job does not set JOB_OBJECT_LIMIT_BREAKAWAY_OK
  const dir = scratch();
  let child = 0;
  try {
    const r = await launch(process.execPath, bunArgs(`import { startBreakingAway } from ${PROTOTYPE}; require('node:fs').writeFileSync((process.env.SEISMIC_TEST_FILE ?? process.env.OBEYA_TEST_FILE), JSON.stringify(startBreakingAway('ping.exe -n 60 127.0.0.1'))); setInterval(() => {}, 1000);`), {
      stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, SEISMIC_TEST_FILE: join(dir, 'result') },
    });
    if (r.boundary !== 'job') throw new Error(r.reason);
    await until(() => read(join(dir, 'result')) !== '');
    const result = JSON.parse(read(join(dir, 'result'))) as { pid: number } | { error: number };
    if ('error' in result) return; // refused: it never ran
    child = result.pid;
    expect(inJob(r.job.name, child)).toBe(true);
    r.job.kill();
    await until(() => !alive(child));
  } finally { kill(child); rmSync(dir, { recursive: true, force: true }); }
});
