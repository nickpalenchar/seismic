import { expect, test } from 'bun:test';
import type { Item } from '../../../../../core/types';
import { FakeRuntime, heard } from '../../../helpers/testing';
import { readDependencies } from '../../../../llms/agents/agentJobs/planDependencies';

const card = (id: string, title: string, state = 'queued', body = ''): Item => ({ id, title, state, body }) as unknown as Item;
const plan = { id: 'p', title: 'Billing', plan: { file: 'docs/plan/billing.md', goal: 'Invoices by mail' } } as unknown as Item;
const kids = [card('a', 'Model', 'done'), card('b', 'Export', 'queued', 'CSV   export\nof invoices'), card('c', 'Mail')];
const keys = new Map([['a', 'model'], ['b', 'export'], ['c', 'mail']]);

const run = async () => {
  const runtime = new FakeRuntime();
  const read = readDependencies({ runtime, cwd: '/repo', plan, kids, keys });
  await heard();
  return { runtime, read };
};

test('the plan and its workstreams are read by a read-only Koordinator session, each under a tag', async () => {
  const { runtime } = await run();
  expect(runtime.last.spec).toMatchObject({ cwd: '/repo', role: 'koordinator', permission: 'readOnly' });
  const brief = runtime.last.inbox[0]!;
  expect(brief).toContain('The plan: "Billing"; plan doc docs/plan/billing.md.');
  expect(brief).toContain('Goal: Invoices by mail');
  expect(brief).toContain('- K1 (delivered): "Model"');
  expect(brief).toContain('- K2: "Export" — CSV export of invoices');
});

test('what each workstream builds on is reported by key, a workstream not named by its own tag left out', async () => {
  const { runtime, read } = await run();
  const answer = runtime.last.call('dependencies', {
    workstreams: [{ card: 'K1', builds_on: [] }, { card: 'K2', builds_on: ['K1', 'K2', 'K9'] }, { card: 'K3', builds_on: ['K2'] }],
  });
  expect(answer).toContain('Recorded');
  expect(await read).toEqual({ model: [], export: ['model'], mail: ['export'] });
});

test('an open workstream left out is asked for again, and what is reported twice is not taken again', async () => {
  const { runtime, read } = await run();
  expect(runtime.last.call('dependencies', { workstreams: [{ card: 'K1', builds_on: [] }] })).toContain('missing K2, K3');
  runtime.last.call('dependencies', { workstreams: [{ card: 'K2', builds_on: [] }, { card: 'K3', builds_on: ['K1'] }] });
  expect(runtime.last.call('dependencies', { workstreams: [] })).toBe('Already reported.');
  expect(await read).toEqual({ export: [], mail: ['model'] });
});

test('a session that ends without a report fails with why', async () => {
  const { runtime, read } = await run();
  runtime.last.emit({ type: 'idle' });
  await expect(read).rejects.toThrow('no dependencies');
  const failed = await run();
  failed.runtime.last.emit({ type: 'error', message: 'no login' });
  await expect(failed.read).rejects.toThrow('no login');
});
