// Runs where a systemd user manager answers (a Linux desktop or server session, or the containers of
// scripts/boundary-matrix.ts); skipped elsewhere, since what it tests does not exist there.
import { afterEach, expect, test } from 'bun:test';
import { testProcessCode } from '../src/test-process';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killScope, launchInScope, unifiedCgroups, type Scope } from './linux-scope-prototype';

const manager = process.platform === 'linux' && unifiedCgroups() && !!Bun.which('systemd-run')
  && spawnSync('systemctl', ['--user', 'show', '-P', 'Version'], { timeout: 5000 }).status === 0;

async function until(check: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() > deadline) throw new Error('timed out'); await Bun.sleep(20); }
}
const read = (file: string) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const kill = (pid: number) => { if (pid > 1) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } };
function scratch() { return mkdtempSync(join(tmpdir(), 'obeya-scope-')); }
function canary() { return spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' }); }
// These commands run through a shell, including through a nested setsid shell.
const quote = (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
const idleCommand = () => [process.execPath, '-e', testProcessCode()].map(quote).join(' ');
// what a failing test started must not outlive it
const started: Scope[] = [];
afterEach(() => { for (const scope of started.splice(0)) try { scope.kill(); } catch { /* reported by the test */ } });
async function launch(...args: Parameters<typeof launchInScope>) {
  const r = await launchInScope(...args);
  if (r.boundary === 'scope') started.push(r.scope);
  return r;
}

test('the unified hierarchy is told from a v1 or hybrid one', () => {
  expect(unifiedCgroups('cgroup2 /sys/fs/cgroup cgroup2 rw,nosuid 0 0\n')).toBe(true);
  expect(unifiedCgroups('tmpfs /sys/fs/cgroup tmpfs ro 0 0\ncgroup2 /sys/fs/cgroup/unified cgroup2 rw 0 0\n')).toBe(false);
});

test.skipIf(!manager)('the agent runs inside its scope from its first instruction, without the report pipe', async () => {
  const dir = scratch();
  try {
    const r = await launch('/bin/sh', ['-c', `cat /proc/self/cgroup > ${dir}/cgroup; [ -e /proc/$$/fd/3 ] && echo open > ${dir}/fd3 || echo closed > ${dir}/fd3; echo $$ > ${dir}/pid`], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.boundary !== 'scope') throw new Error(r.reason);
    await new Promise((resolve) => r.child.once('exit', resolve));
    expect(read(`${dir}/cgroup`)).toBe(`0::${r.scope.cgroup}`);
    expect(read(`${dir}/fd3`)).toBe('closed');
    // systemd-run and the gate exec in place: the pid the caller holds is the agent's
    expect(Number(read(`${dir}/pid`))).toBe(r.child.pid!);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!manager)('ending the scope stops a daemon that detached before anything could sample it, and nothing else', async () => {
  const dir = scratch();
  const other = canary();
  let daemon = 0;
  try {
    // double fork into a session of its own, and the agent gone at once: no ancestry left to follow
    const r = await launch('/bin/sh', ['-c', `setsid sh -c ${quote(`echo $$ > ${dir}/daemon; exec ${idleCommand()}`)} </dev/null >/dev/null 2>&1 & exit 0`], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.boundary !== 'scope') throw new Error(r.reason);
    await until(() => (daemon = Number(read(`${dir}/daemon`))) > 1);
    await new Promise((resolve) => r.child.exitCode !== null ? resolve(null) : r.child.once('exit', resolve));
    expect(r.scope.members()).toContain(daemon);
    expect(r.scope.kill()).toBe('cgroup.kill');
    await until(() => !alive(daemon) && r.scope.members().length === 0);
    expect(alive(other.pid!)).toBe(true);
  } finally { kill(daemon); other.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!manager)('a scope outlives its caller, and a sweep ends it by name', async () => {
  const dir = scratch();
  const other = canary();
  let daemon = 0;
  let agent = 0;
  // the caller is a process of its own, killed like a crashed Seismic
  const caller = spawn(process.execPath, ['-e', testProcessCode(`
    import { launchInScope } from ${JSON.stringify(join(import.meta.dir, 'linux-scope-prototype.ts'))};
    const r = await launchInScope('/bin/sh', ['-c', ${JSON.stringify(`setsid ${idleCommand()} </dev/null >/dev/null 2>&1 & echo $! > ${dir}/daemon; exec ${idleCommand()}`)}], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (r.boundary !== 'scope') { console.error(r.reason); process.exit(1); }
    console.log(JSON.stringify({ unit: r.scope.unit, cgroup: r.scope.cgroup, agent: r.child.pid }));
    setInterval(() => {}, 1000);
  `)], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const line = await new Promise<string>((resolve) => caller.stdout!.once('data', (chunk: Buffer) => resolve(chunk.toString())));
    const { unit, cgroup, agent: pid } = JSON.parse(line) as { unit: string; cgroup: string; agent: number };
    agent = pid;
    await until(() => (daemon = Number(read(`${dir}/daemon`))) > 1);
    caller.kill('SIGKILL');
    await new Promise((resolve) => caller.once('exit', resolve));
    await Bun.sleep(200);
    expect(alive(agent) && alive(daemon)).toBe(true);
    expect(killScope(unit, cgroup)).toBe('cgroup.kill');
    await until(() => !alive(agent) && !alive(daemon));
    await until(() => !existsSync(`/sys/fs/cgroup${cgroup}`));
    // a second sweep finds nothing to do
    expect(killScope(unit, cgroup)).toBe('gone');
    expect(alive(other.pid!)).toBe(true);
  } finally { caller.kill('SIGKILL'); kill(agent); kill(daemon); other.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!manager)("the agent's exit leaves its app running in the scope, for parking or the caller to end", async () => {
  // what ends the app stays Seismic's decision (app.stop, or the session's end), not the scope's
  const dir = scratch();
  let app = 0;
  try {
    const r = await launch('/bin/sh', ['-c', `setsid ${idleCommand()} </dev/null >/dev/null 2>&1 & echo $! > ${dir}/app`], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.boundary !== 'scope') throw new Error(r.reason);
    await new Promise((resolve) => r.child.exitCode !== null ? resolve(null) : r.child.once('exit', resolve));
    app = Number(read(`${dir}/app`));
    await Bun.sleep(300);
    expect(alive(app)).toBe(true);
    expect(r.scope.members()).toEqual([app]);
    // app.stop, run by Seismic outside the scope, ends the app; the empty scope then goes by itself
    process.kill(app, 'SIGTERM');
    await until(() => !existsSync(`/sys/fs/cgroup${r.scope.cgroup}`));
  } finally { kill(app); rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!manager)('without a reachable user manager it starts nothing and says why', async () => {
  const dir = scratch();
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_RUNTIME_DIR: join(dir, 'no-manager') };
    delete env.DBUS_SESSION_BUS_ADDRESS;
    const r = await launch('/bin/sh', ['-c', `touch ${dir}/ran`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    expect(r.boundary).toBe('none');
    expect(r.boundary === 'none' && r.reason).toContain('systemd-run exited (1)');
    expect(existsSync(`${dir}/ran`)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
