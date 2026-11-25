import { afterEach, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { testProcessCode } from '../../../../test-process';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverDir } from '../../helpers/paths';
import { gitRepo } from '../../helpers/testing';
import { processes } from '../../../llms/harnesses/processes';
import { environment, SessionRegistry, type SessionRecord } from '../../../llms/harnesses/sessionRegistry';



const supported = environment() !== undefined && process.platform !== 'win32';
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const born = (pid: number) => processes().find((p) => p.pid === pid)?.born;
async function until(check: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out'); await Bun.sleep(20); }
}
const idle = (extra = '') => ['-e', testProcessCode(`${extra};setInterval(()=>{},1000)`)];

const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0)) try { f(); } catch {  } });
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'seismic-sessions-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'sessions');
}
function start(extra = ''): ChildProcess {
  const child = spawn(process.execPath, idle(extra), { detached: true, stdio: 'ignore' });
  cleanup.push(() => { try { process.kill(child.pid!, 'SIGKILL'); } catch {  } });
  return child;
}
/**
 * Owner: a process that takes a lease, starts `jobs` processes of their own group, records them,
 * writes their pids to `ready` and waits to be killed. Their parent is the owner, so after its
 * crash they are orphans, as after a crash of Seismic.
 */
function owner(root: string, ready: string, jobs: number) {
  const code = testProcessCode(`
    import { spawn } from 'node:child_process';
    import { SessionRegistry } from ${JSON.stringify(join(serverDir, 'llms/harnesses', 'sessionRegistry'))};
    import { processes } from ${JSON.stringify(join(serverDir, 'llms/harnesses', 'processes'))};
    const g = await new SessionRegistry(${JSON.stringify(root)}).begin('test session', '/work/a');
    const pids = Array.from({ length: ${jobs} }, () => spawn(process.execPath, ['-e', ${JSON.stringify(testProcessCode())}], { detached: true, stdio: 'ignore' }).pid);
    const table = processes();
    await g.publish(pids.map((pid) => ({ pid, born: table.find((p) => p.pid === pid).born })));
    await Bun.write(${JSON.stringify(ready)}, JSON.stringify(pids));
    setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, ['-e', code], { detached: true, stdio: 'inherit' });
  cleanup.push(() => {
    try { process.kill(child.pid!, 'SIGKILL'); } catch {  }
    try { for (const pid of JSON.parse(readFileSync(ready, 'utf8')) as number[]) process.kill(pid, 'SIGKILL'); } catch {  }
  });
  return child;
}
const pidsOf = (ready: string) => JSON.parse(readFileSync(ready, 'utf8')) as number[];
const crash = async (child: ChildProcess) => {
  const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await gone;
};

test.skipIf(!supported)('after a crash, the recorded work ends; an unrelated canary and a lookalike stay', async () => {
  const root = scratch();
  const ready = join(root, '..', 'ready');
  const canary = start();
  const dead = owner(root, ready, 2);
  await until(() => existsSync(ready));
  const [job, lookalike] = pidsOf(ready).map((pid) => ({ pid })) as [{ pid: number }, { pid: number }];
  
  const file = readdirSync(root).find((n) => n.endsWith('.json'))!;
  const record: SessionRecord = JSON.parse(readFileSync(join(root, file), 'utf8'));
  expect(record.processes.map((p) => p.pid)).toEqual([job.pid!, lookalike.pid!]);
  writeFileSync(join(root, file), JSON.stringify({ ...record, processes: [record.processes[0]!, { pid: lookalike.pid!, born: 'Mon Jan  1 00:00:00 2001' }] }));

  const registry = new SessionRegistry(root);
  
  expect(registry.recover().map((r) => r.outcome)).toEqual(['busy']);
  expect(alive(job.pid!)).toBe(true);

  await crash(dead);
  const [result] = registry.recover();
  expect(result).toMatchObject({ outcome: 'recovered', label: 'test session', killed: [job.pid!] });
  await until(() => !alive(job.pid!));
  expect(alive(canary.pid!)).toBe(true);
  expect(alive(lookalike.pid!)).toBe(true);
  expect(readdirSync(root)).toEqual([]);
  expect(registry.recover()).toEqual([]);
}, 20_000);

test.skipIf(!supported)('another live Seismic on the same directory keeps its sessions through a sweep', async () => {
  const root = scratch();
  const ready1 = join(root, '..', 'ready1'), ready2 = join(root, '..', 'ready2');
  const crashed = owner(root, ready1, 1);
  const live = owner(root, ready2, 1);
  await until(() => existsSync(ready1) && existsSync(ready2));
  const mine = { pid: pidsOf(ready1)[0] }, theirs = { pid: pidsOf(ready2)[0] };
  await crash(crashed);
  const results = new SessionRegistry(root).recover();
  expect(results.map((r) => r.outcome).sort()).toEqual(['busy', 'recovered']);
  await until(() => !alive(mine.pid!));
  expect(alive(theirs.pid!)).toBe(true);
  expect(alive(live.pid!)).toBe(true);
}, 20_000);

test.skipIf(!supported || process.platform !== 'linux')('a record from before the boot id joined the identity (bare start ticks) still recovers its work', async () => {
  const root = scratch();
  const ready = join(root, '..', 'ready');
  const dead = owner(root, ready, 1);
  await until(() => existsSync(ready));
  const job = { pid: pidsOf(ready)[0]! };
  const file = readdirSync(root).find((n) => n.endsWith('.json'))!;
  const record: SessionRecord = JSON.parse(readFileSync(join(root, file), 'utf8'));
  const legacy = record.processes.map((p) => ({ ...p, born: p.born.slice(p.born.lastIndexOf(':') + 1) }));
  expect(legacy[0]!.born).not.toBe(record.processes[0]!.born);
  writeFileSync(join(root, file), JSON.stringify({ ...record, processes: legacy }));
  await crash(dead);
  expect(new SessionRegistry(root).recover()[0]).toMatchObject({ outcome: 'recovered', killed: [job.pid] });
  await until(() => !alive(job.pid));
}, 20_000);

test.skipIf(!supported)('this process holding a lease is not a candidate for its own sweep', async () => {
  const root = scratch();
  const registry = new SessionRegistry(root);
  const job = start();
  const g = (await registry.begin('mine', '/work/b'))!;
  await g.publish([{ pid: job.pid!, born: born(job.pid!)! }]);
  expect(registry.recover().map((r) => r.outcome)).toEqual(['busy']);
  expect(alive(job.pid!)).toBe(true);
  await g.finish();
  expect(readdirSync(root)).toEqual([]);
});

test.skipIf(!supported)('processes that survive the signal leave the record for a later sweep', async () => {
  const root = scratch();
  const ready = join(root, '..', 'ready');
  const dead = owner(root, ready, 1);
  await until(() => existsSync(ready));
  const job = { pid: pidsOf(ready)[0] };
  await crash(dead);
  const registry = new SessionRegistry(root);
  const [first] = registry.recover({ kill: () => ({ signalled: [], failure: new Error('operation not permitted') }), settleMs: 100 });
  expect(first).toMatchObject({ outcome: 'unrecovered' });
  expect(first!.detail).toContain('operation not permitted');
  expect(alive(job.pid!)).toBe(true);
  expect(readdirSync(root).length).toBe(2);
  expect(registry.recover()[0]).toMatchObject({ outcome: 'recovered' });
  await until(() => !alive(job.pid!));
}, 20_000);

test.skipIf(!supported)('a record from a foreign host or an unreadable one never gets a signal', async () => {
  const root = scratch();
  const ready = join(root, '..', 'ready');
  const dead = owner(root, ready, 1);
  await until(() => existsSync(ready));
  const job = { pid: pidsOf(ready)[0] };
  await crash(dead);
  const file = readdirSync(root).find((n) => n.endsWith('.json'))!;
  const record: SessionRecord = JSON.parse(readFileSync(join(root, file), 'utf8'));
  const registry = new SessionRegistry(root);

  writeFileSync(join(root, file), JSON.stringify({ ...record, host: 'another-machine' }));
  expect(registry.recover()[0]).toMatchObject({ outcome: 'unknown' });
  expect(registry.recover()[0]).toMatchObject({ outcome: 'unknown' }); 

  writeFileSync(join(root, file), '{ not json');
  expect(registry.recover()[0]).toMatchObject({ outcome: 'quarantined' });
  expect(readdirSync(join(root, 'quarantine')).length).toBe(2);
  expect(alive(job.pid!)).toBe(true);
});

test.skipIf(!supported)('a workstation whose old session could not be ended is reported until it is', async () => {
  const root = scratch();
  const ready = join(root, '..', 'ready');
  const dead = owner(root, ready, 1);
  await until(() => existsSync(ready));
  const registry = new SessionRegistry(root);
  expect(registry.unaccounted('/work/a').length).toBe(1); 
  await crash(dead);
  expect(registry.unaccounted('/work/a')).toEqual([{ generation: expect.any(String), label: 'test session' }]);
  expect(registry.unaccounted('/work/other')).toEqual([]);
  registry.recover();
  expect(registry.unaccounted('/work/a')).toEqual([]);
  
  const g = (await registry.begin('mine', '/work/b'))!;
  expect(registry.unaccounted('/work/b')).toEqual([]);
  await g.finish();
});

test.skipIf(!supported)('a record from an earlier boot is dropped without signalling its pids', async () => {
  const root = scratch();
  const ready = join(root, '..', 'ready');
  const dead = owner(root, ready, 1);
  await until(() => existsSync(ready));
  const job = { pid: pidsOf(ready)[0] };
  await crash(dead);
  const file = readdirSync(root).find((n) => n.endsWith('.json'))!;
  const record: SessionRecord = JSON.parse(readFileSync(join(root, file), 'utf8'));
  writeFileSync(join(root, file), JSON.stringify({ ...record, boot: 'an earlier boot' }));
  expect(new SessionRegistry(root).recover()[0]).toMatchObject({ outcome: 'cleared' });
  expect(alive(job.pid!)).toBe(true);
  expect(readdirSync(root)).toEqual([]);
});

test('without process identities, sessions are not recorded and a sweep finds nothing', async () => {
  const root = scratch();
  const registry = new SessionRegistry(root, null);
  expect(registry.supported).toBe(false);
  expect(await registry.begin('x', '/', () => {})).toBeUndefined();
  expect(registry.recover()).toEqual([]);
});

test.skipIf(!supported)('an unwritable registry runs the session unrecorded and warns', async () => {
  const root = join(scratch(), 'file');
  mkdirSync(join(root, '..'), { recursive: true });
  writeFileSync(root, 'not a directory');
  const warnings: string[] = [];
  expect(await new SessionRegistry(root).begin('x', '/', (m) => warnings.push(m))).toBeUndefined();
  expect(warnings.length).toBe(1);
});

test.skipIf(!supported)('a crash of the host of a Codex transport: the next sweep ends its app-server and the PTY it observed', async () => {
  const root = scratch();
  const ready = join(root, '..', 'ready');
  const appCode = testProcessCode(`const {spawn}=require('node:child_process');
const leaf=spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{detached:true,stdio:'ignore'});
require('node:fs').writeFileSync(${JSON.stringify(join(root, '..', 'leaf'))},String(leaf.pid));setInterval(()=>{},1000);`);
  const host = spawn(process.execPath, ['-e', testProcessCode(`
    import { codexConnection } from ${JSON.stringify(join(serverDir, 'llms/harnesses', 'codexRpc'))};
    import { SessionRegistry, useSessionRegistry } from ${JSON.stringify(join(serverDir, 'llms/harnesses', 'sessionRegistry'))};
    import { readFileSync } from 'node:fs';
    useSessionRegistry(new SessionRegistry(${JSON.stringify(root)}));
    const c = codexConnection({ command: process.execPath, args: ['-e', ${JSON.stringify(appCode)}], cwd: '/', env: process.env, label: 'Codex in /scratch' }, { notification() {}, request: async () => ({}) });
    let leaf = 0;
    while (!leaf) { try { leaf = Number(readFileSync(${JSON.stringify(join(root, '..', 'leaf'))}, 'utf8')); } catch {} await Bun.sleep(10); }
    await c.trackProcesses([leaf]);
    await Bun.write(${JSON.stringify(ready)}, JSON.stringify([c.pid, leaf]));
    setInterval(() => {}, 1000);`)], { detached: true, stdio: 'inherit' });
  cleanup.push(() => { try { process.kill(host.pid!, 'SIGKILL'); } catch {  } try { for (const pid of pidsOf(ready)) process.kill(pid, 'SIGKILL'); } catch {  } });
  const canary = start();
  await until(() => existsSync(ready));
  const [app, leaf] = pidsOf(ready) as [number, number];
  
  const recorded = () => readdirSync(root).filter((n) => n.endsWith('.json')).flatMap((n) => {
    try { return (JSON.parse(readFileSync(join(root, n), 'utf8')) as SessionRecord).processes.map((p) => p.pid); } catch { return []; }
  });
  await until(() => recorded().includes(app) && recorded().includes(leaf));
  await crash(host);
  expect(alive(app) && alive(leaf)).toBe(true); 
  const [result] = new SessionRegistry(root).recover();
  expect(result).toMatchObject({ outcome: 'recovered', label: 'Codex in /scratch' });
  expect(result!.killed).toEqual(expect.arrayContaining([app, leaf]));
  await until(() => !alive(app) && !alive(leaf));
  expect(alive(canary.pid!)).toBe(true);
  expect(readdirSync(root)).toEqual([]);
}, 20_000);

test.skipIf(!supported)('a crash of the host of an agy session: the next sweep ends agy and the command it detached', async () => {
  const root = scratch();
  const repo = join(root, '..', 'repo');
  gitRepo(repo);
  const ready = join(root, '..', 'ready');
  const leafFile = join(root, '..', 'leaf');
  const agyCode = testProcessCode(`const {spawn}=require('node:child_process');
const leaf=spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{detached:true,stdio:'ignore'});
require('node:fs').writeFileSync(${JSON.stringify(leafFile)},String(leaf.pid));setInterval(()=>{},1000);`);
  const host = spawn(process.execPath, ['-e', testProcessCode(`
    import { createAgyRuntime } from ${JSON.stringify(join(serverDir, 'llms/harnesses', 'agy'))};
    import { SessionRegistry, useSessionRegistry } from ${JSON.stringify(join(serverDir, 'llms/harnesses', 'sessionRegistry'))};
    import { spawn } from 'node:child_process';
    import { readFileSync } from 'node:fs';
    useSessionRegistry(new SessionRegistry(${JSON.stringify(root)}));
    let pid = 0;
    const launch = (_c, _a, o) => { const child = spawn(process.execPath, ['-e', ${JSON.stringify(agyCode)}], { ...o, stdio: ['pipe', 'pipe', 'pipe'] }); pid = child.pid; return child; };
    createAgyRuntime(launch, () => '/fake/agy').start({ cwd: ${JSON.stringify(repo)}, system: 's', tools: [], onEvent() {} });
    let leaf = 0;
    while (!leaf) { try { leaf = Number(readFileSync(${JSON.stringify(leafFile)}, 'utf8')); } catch {} await Bun.sleep(10); }
    await Bun.sleep(1500); // the observation ticks pick the detached command up
    await Bun.write(${JSON.stringify(ready)}, JSON.stringify([pid, leaf]));
    setInterval(() => {}, 1000);`)], { detached: true, stdio: 'inherit' });
  cleanup.push(() => { try { process.kill(host.pid!, 'SIGKILL'); } catch {  } try { for (const pid of pidsOf(ready)) process.kill(pid, 'SIGKILL'); } catch {  } });
  const canary = start();
  await until(() => existsSync(ready), 15000);
  const [agy, leaf] = pidsOf(ready) as [number, number];
  await crash(host);
  expect(alive(agy) && alive(leaf)).toBe(true);
  const [result] = new SessionRegistry(root).recover();
  expect(result).toMatchObject({ outcome: 'recovered', label: expect.stringContaining('Antigravity') });
  expect(result!.killed).toEqual(expect.arrayContaining([agy, leaf]));
  await until(() => !alive(agy) && !alive(leaf));
  expect(alive(canary.pid!)).toBe(true);
  expect(readdirSync(root)).toEqual([]);
}, 30_000);

test.skipIf(!supported)('a Codex transport that ends in order removes its own record', async () => {
  const root = scratch();
  const code = testProcessCode(`
    import { codexConnection } from ${JSON.stringify(join(serverDir, 'llms/harnesses', 'codexRpc'))};
    import { SessionRegistry, useSessionRegistry } from ${JSON.stringify(join(serverDir, 'llms/harnesses', 'sessionRegistry'))};
    import { readdirSync } from 'node:fs';
    useSessionRegistry(new SessionRegistry(${JSON.stringify(root)}));
    const c = codexConnection({ command: process.execPath, args: ['-e', ${JSON.stringify(testProcessCode('process.stdin.resume()'))}], cwd: '/', env: process.env }, { notification() {}, request: async () => ({}) });
    await c.trackProcesses([]); // publication follows the asynchronous identity snapshot
    const during = readdirSync(${JSON.stringify(root)}).length;
    c.close();
    await c.done;
    console.log(JSON.stringify([during > 0, readdirSync(${JSON.stringify(root)}).length]));`);
  const out = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  let text = '';
  out.stdout.on('data', (d) => { text += d; });
  await new Promise((resolve) => out.once('exit', resolve));
  expect(JSON.parse(text.trim().split('\n').pop()!)).toEqual([true, 0]);
}, 20_000);


const testEnvironment = { host: 'test', boot: 'boot', namespace: 'test' };

test('concurrent publications stay ordered and abandonment keeps the last durable record', async () => {
  const root = scratch();
  const registry = new SessionRegistry(root, testEnvironment);
  const g = (await registry.begin('ordered', '/work'))!;
  const first = g.publish([{ pid: 1, born: 'first' }]);
  const last = g.publish([{ pid: 1, born: 'first' }, { pid: 2, born: 'last' }]);
  const abandoned = g.abandon();
  
  expect(() => g.publish([])).toThrow('closed');
  expect(registry.recover().map((r) => r.outcome)).toEqual(['busy']);
  await Promise.all([first, last, abandoned]);
  const record = JSON.parse(readFileSync(join(root, `${g.id}.json`), 'utf8'));
  expect(record.processes).toEqual([{ pid: 1, born: 'first' }, { pid: 2, born: 'last' }]);
  
  const running = () => new Map([[2, { pid: 2, born: 'last', parent: 0, group: 0 }]]);
  expect(registry.unaccounted('/work', { table: running })).toEqual([{ generation: g.id, label: 'ordered' }]);
  expect(existsSync(join(root, `${g.id}.json`))).toBe(true);
});

test('an abandoned record of which nothing runs any more blocks no new session in its directory', async () => {
  const root = scratch();
  const registry = new SessionRegistry(root, testEnvironment);
  const g = (await registry.begin('listing models', '/home'))!;
  await g.publish([{ pid: 7, born: 'gone' }]);
  await g.abandon();
  const none = () => new Map();
  expect(registry.unaccounted('/elsewhere', { table: none })).toEqual([]);
  expect(existsSync(join(root, `${g.id}.json`))).toBe(true); 
  expect(registry.unaccounted('/home', { table: none })).toEqual([]);
  expect(readdirSync(root)).toEqual([]);
});

test('a record whose owner still holds its lease stays unaccounted without being judged', async () => {
  
  const root = scratch();
  mkdirSync(root, { recursive: true });
  const id = crypto.randomUUID();
  const record: SessionRecord = { version: 1, generation: id, ...testEnvironment, owner: 1, label: 'other Seismic', cwd: '/home', processes: [{ pid: 7, born: 'gone' }] };
  writeFileSync(join(root, `${id}.json`), JSON.stringify(record));
  writeFileSync(join(root, `${id}.lease.sqlite`), '');
  const lease = new Database(join(root, `${id}.lease.sqlite`));
  lease.exec('BEGIN IMMEDIATE');
  try {
    expect(new SessionRegistry(root, testEnvironment).unaccounted('/home', { table: () => new Map() })).toEqual([{ generation: id, label: 'other Seismic' }]);
    expect(existsSync(join(root, `${id}.json`))).toBe(true);
  } finally { lease.exec('ROLLBACK'); lease.close(); }
});

test('finish drains queued publications before removing the record and releasing its lease', async () => {
  const root = scratch();
  const registry = new SessionRegistry(root, testEnvironment);
  const g = (await registry.begin('finishing', '/work'))!;
  const publications = Array.from({ length: 10 }, (_, n) => g.publish([{ pid: n + 1, born: 'birth' }]));
  let ticked = false;
  const timer = new Promise<void>((resolve) => setTimeout(() => { ticked = true; resolve(); }, 0));
  const finished = g.finish();
  expect(g.finish()).toBe(finished);
  await Promise.all([...publications, finished, timer]);
  expect(ticked).toBe(true);
  expect(readdirSync(root)).toEqual([]);
  expect(registry.recover()).toEqual([]);
});

test('a failed publication rejects without poisoning later writes or cleanup', async () => {
  const root = scratch();
  const registry = new SessionRegistry(root, testEnvironment);
  const g = (await registry.begin('retry', '/work'))!;
  const file = join(root, `${g.id}.json`);
  
  rmSync(file);
  mkdirSync(file);
  await expect(g.publish([{ pid: 1, born: 'birth' }])).rejects.toThrow();
  expect(readdirSync(root).some((n) => n.endsWith('.tmp'))).toBe(false);
  rmSync(file, { recursive: true });
  await g.publish([{ pid: 2, born: 'retry' }]);
  expect(JSON.parse(readFileSync(file, 'utf8')).processes).toEqual([{ pid: 2, born: 'retry' }]);
  await g.finish();
  expect(readdirSync(root)).toEqual([]);
});

test('a slow registry rename leaves timers free and holds the lease until cleanup drains it', async () => {
  const root = scratch();
  const registry = new SessionRegistry(root, testEnvironment);
  const g = (await registry.begin('slow disk', '/work'))!;
  const rename = fsPromises.rename;
  let entered!: () => void;
  const writing = new Promise<void>((resolve) => { entered = resolve; });
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  const slow = spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
    entered();
    await blocked;
    return rename(from, to);
  });
  try {
    const publication = g.publish([{ pid: 1, born: 'birth' }]);
    await writing;
    const finished = g.finish();
    await Bun.sleep(20);
    expect(registry.recover().map((r) => r.outcome)).toEqual(['busy']);
    expect(existsSync(join(root, `${g.id}.json`))).toBe(true);
    unblock();
    await Promise.all([publication, finished]);
    expect(readdirSync(root)).toEqual([]);
  } finally { unblock(); slow.mockRestore(); }
});
