import { expect, test } from 'bun:test';
import { testProcessCode } from '../src/test-process';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGeneration, inspectGeneration, processIdentity, type ProcessIdentity } from './agent-registry-prototype';

const sample = (pid: number, start = '123'): ProcessIdentity => ({ pid, boot: 'boot-a', namespace: 'ns-a', start });
const lookup = (pid: number) => pid === process.pid ? sample(pid) : pid === 100 ? sample(pid) : pid === 101 ? sample(pid, '456') : undefined;

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('registry prototype timed out'); await Bun.sleep(20); }
}

test.skipIf(process.platform !== 'linux')('Linux process identity includes boot, PID namespace and stable start ticks', () => {
  const first = processIdentity(process.pid);
  expect(first).toBeDefined();
  expect(first?.pid).toBe(process.pid);
  expect(first?.start).toMatch(/^\d+$/);
  expect(processIdentity(process.pid)).toEqual(first);
});

test('an active lease prevents inspection; after release identities are report-only', () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-registry-'));
  const owner = createGeneration(root, sample(42));
  try {
    owner.publish([sample(100), sample(101), sample(102)]);
    expect(inspectGeneration(root, owner.id, lookup).state).toBe('unknown');
    owner.close();
    expect(inspectGeneration(root, owner.id, lookup)).toMatchObject({ state: 'inspectable', processes: [
      { pid: 100, state: 'match' }, { pid: 101, state: 'different' }, { pid: 102, state: 'missing-or-hidden' },
    ] });
    expect(() => owner.publish([])).toThrow('Registry lease is closed');
    expect(inspectGeneration(root, '../not-a-generation', lookup).state).toBe('unknown');
  } finally { owner.close(); rmSync(root, { recursive: true, force: true }); }
});

test('different boot, inaccessible identity and corrupt records never authorize inspection', () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-registry-'));
  const owner = createGeneration(root, sample(42));
  try {
    owner.publish([sample(100)]); owner.close();
    expect(inspectGeneration(root, owner.id, (pid) => ({ ...sample(pid), boot: 'boot-b' }))).toMatchObject({ state: 'unknown', reason: 'boot or namespace mismatch' });
    expect(inspectGeneration(root, owner.id, () => undefined)).toMatchObject({ state: 'unknown', reason: 'identity unavailable on this platform' });
    writeFileSync(join(root, `${owner.id}.json`), '{bad json');
    expect(inspectGeneration(root, owner.id, lookup)).toMatchObject({ state: 'unknown', reason: 'record inaccessible or invalid' });
  } finally { owner.close(); rmSync(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === 'win32')('a killed owner releases its generation lease to a later inspector', async () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-registry-'));
  const ready = join(root, 'ready');
  const module = join(import.meta.dir, 'agent-registry-prototype.ts');
  const code = testProcessCode(`import {createGeneration} from ${JSON.stringify(module)};import {writeFileSync} from 'node:fs';const x=createGeneration(${JSON.stringify(root)},{pid:42,boot:'boot-a',namespace:'ns-a',start:'123'});x.publish([{pid:100,boot:'boot-a',namespace:'ns-a',start:'123'}]);writeFileSync(${JSON.stringify(ready)},x.id);setInterval(()=>{},1000);`);
  const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
  try {
    const fs = await import('node:fs');
    let id = '';
    await until(() => { try { id = fs.readFileSync(ready, 'utf8'); return !!id; } catch { return false; } });
    expect(inspectGeneration(root, id, lookup).state).toBe('unknown');
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL'); await exited;
    expect(inspectGeneration(root, id, lookup)).toMatchObject({ state: 'inspectable', processes: [{ pid: 100, state: 'match' }] });
  } finally { child.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); }
}, 10_000);
