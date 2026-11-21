import { expect, test } from 'bun:test';
import type { Item } from '../../../../../core/types';
import type { Board } from '../../../../board';
import { CardTags } from '../../../../llms/agents/agentJobs/cardTags';
import { scheduleCardBatch } from '../../../../llms/agents/agentJobs/scheduleCardBatch';
import { FakeRuntime, heard } from '../../../helpers/testing';

const item = (id: string, over: Partial<Item> = {}) => ({ id, title: id, state: 'queued', kind: 'task', body: '', ...over }) as unknown as Item;
const a = item('a', { body: 'Do   A\nnow' });
const b = item('b');
const running = item('r');
const twin = item('t');
const plan = item('p', { title: 'Billing', plan: { file: 'docs/plan/billing.md', goal: 'Invoices' } } as Partial<Item>);
const board = { item: () => undefined } as unknown as Board;

const run = async (over: Partial<Parameters<typeof scheduleCardBatch>[0]> = {}) => {
  const runtime = new FakeRuntime();
  const batch = [a, b];
  const active = [running];
  const candidates = [twin];
  const waits: string[] = [];
  const scheduled = scheduleCardBatch({
    runtime, board, cwd: '/repo', planCard: undefined, batch, active, ahead: [], candidates, tags: new CardTags(active, [], batch, candidates), merges: true, folder: false,
    language: 'German', preferences: 'Be brief.', others: async () => ['Cards in progress: r.'], onLimit: (until) => void waits.push(String(until)), ...over,
  });
  await heard();
  return { runtime, scheduled, waits };
};

test('cards freed at once are scheduled by a read-only Koordinator session whose brief lists them with what runs beside them', async () => {
  const { runtime } = await run();
  expect(runtime.last.spec).toMatchObject({ cwd: '/repo', role: 'koordinator', permission: 'readOnly' });
  expect(runtime.last.spec.system.endsWith('\n\nBe brief.')).toBe(true);
  const brief = runtime.last.inbox[0]!;
  expect(brief).toContain('The cards to schedule, freed at once');
  expect(brief).toContain('- K2: task "a" — Do A now');
  expect(brief).toContain('Cards in progress: r.');
  expect(brief).toContain('- K4: "t" (queued)');
});

test('the workstreams of a plan are listed under the plan, and the report is of workstreams', async () => {
  const { runtime } = await run({ planCard: plan });
  const brief = runtime.last.inbox[0]!;
  expect(brief).toContain('The plan: "Billing"; plan doc docs/plan/billing.md.');
  expect(brief).toContain('Goal: Invoices');
  expect(brief).toContain("Its workstreams to schedule, in the plan's order:");
  expect(runtime.last.spec.tools[0]!.description).toContain('Report every workstream once');
});

test('each card is reported once, in the order given, waiting for what it builds on and collides with', async () => {
  const { runtime, scheduled } = await run();
  const answer = runtime.last.call('schedule', {
    workstreams: [
      { card: 'K3', files: ['b.ts'], builds_on: [], conflicts_with: ['K1'], duplicates: ['K4', 'K1'], reason: 'Collides with the running one.' },
      { card: 'K2', files: ['a.ts'], builds_on: ['K3', 'K2', 'K9'], conflicts_with: [], reason: 'After B.' },
      { card: 'K2', files: [], builds_on: [], conflicts_with: [], reason: 'twice' },
      { card: 'K1', files: [], builds_on: [], conflicts_with: [], reason: 'not in the batch' },
    ],
  });
  expect(answer).toContain('Recorded');
  expect(await scheduled).toEqual([
    { card: 'b', files: ['b.ts'], duplicates: ['t'], waitsFor: ['r'], buildsOn: [], reason: 'Collides with the running one.' },
    { card: 'a', files: ['a.ts'], duplicates: [], waitsFor: ['b'], buildsOn: ['b'], reason: 'After B.' },
  ]);
});

test('a card left out is asked for again, a second report is refused, and a session without one fails with why', async () => {
  const { runtime, scheduled } = await run();
  expect(runtime.last.call('schedule', { workstreams: [{ card: 'K2', files: [], builds_on: [], conflicts_with: [], reason: 'x' }] })).toContain('missing K3');
  runtime.last.call('schedule', { workstreams: [{ card: 'K2', files: [], builds_on: [], conflicts_with: [], reason: 'x' }, { card: 'K3', files: [], builds_on: [], conflicts_with: [], reason: 'y' }] });
  expect(runtime.last.call('schedule', { workstreams: [] })).toBe('Already reported.');
  expect(await scheduled).toHaveLength(2);
  const none = await run();
  none.runtime.last.emit({ type: 'idle' });
  await expect(none.scheduled).rejects.toThrow('no schedule');
});

test('with merge suggestions off there are no candidates in the brief and no duplicates in the tool', async () => {
  const { runtime } = await run({ merges: false, candidates: [] });
  expect(runtime.last.inbox[0]).not.toContain('Other unfinished tasks');
  expect(Object.keys((runtime.last.spec.tools[0]!.schema as unknown as { workstreams: { element: { shape: object } } }).workstreams.element.shape)).not.toContain('duplicates');
});
