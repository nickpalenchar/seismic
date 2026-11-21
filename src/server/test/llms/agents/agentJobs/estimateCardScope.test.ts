import { expect, test } from 'bun:test';
import type { Item } from '../../../../../core/types';
import { CardTags } from '../../../../llms/agents/agentJobs/cardTags';
import { estimateCardScope } from '../../../../llms/agents/agentJobs/estimateCardScope';
import { FakeRuntime, heard } from '../../../helpers/testing';

const item = (id: string, over: Partial<Item> = {}) => ({ id, title: id, state: 'queued', body: '', ...over }) as unknown as Item;
const card = item('c', { parent: 'p' });
const running = item('r');
const sibling = item('s', { parent: 'p' });
const twin = item('t');

const run = async (over: Partial<Parameters<typeof estimateCardScope>[0]> = {}) => {
  const runtime = new FakeRuntime();
  const onLimit = () => {};
  const active = [running];
  const pending = [sibling];
  const candidates = [twin];
  const scope = estimateCardScope({
    runtime, cwd: '/repo', card, active, ahead: [], pending, candidates, tags: new CardTags(active, [], pending, candidates), merges: true, folder: false,
    language: 'German unless a preference names another', preferences: 'Be brief.', brief: async () => 'The card to start.', onLimit, ...over,
  });
  await heard();
  return { runtime, scope, onLimit };
};

test('the card is estimated by a read-only Koordinator session that reads the brief given, with the candidates after it, and the owner’s preferences after the instructions', async () => {
  const { runtime, onLimit } = await run();
  expect(runtime.last.spec).toMatchObject({ cwd: '/repo', role: 'koordinator', permission: 'readOnly', onLimit });
  expect(runtime.last.spec.system.endsWith('\n\nBe brief.')).toBe(true);
  expect(runtime.last.inbox[0]).toStartWith('The card to start.\n\nOther unfinished tasks to check for the same requested outcome');
  expect(runtime.last.inbox[0]).toContain('- K3: "t" (queued)');
});

test('with merge suggestions off the brief has no candidates and the tool no duplicates', async () => {
  const { runtime } = await run({ merges: false });
  expect(runtime.last.inbox[0]).toBe('The card to start.');
  expect(Object.keys(runtime.last.spec.tools[0]!.schema)).toEqual(['files', 'conflicts_with', 'builds_on', 'reason']);
});

test('what is reported is kept to the cards it may name: conflicts with what runs, building on siblings, duplicates among the candidates', async () => {
  const { runtime, scope } = await run();
  runtime.last.call('scope', { files: ['a.ts'], conflicts_with: ['K1', 'K2', 'K3', 'K9'], builds_on: ['K1', 'K2'], duplicates: ['K3', 'K1'], reason: 'Same file.' });
  expect(await scope).toEqual({ files: ['a.ts'], duplicates: ['t'], conflictsWith: ['r'], buildsOn: ['s'], reason: 'Same file.' });
});

test('a second report is refused, and a session that ends without one fails with why', async () => {
  const first = await run();
  first.runtime.last.call('scope', { files: [], conflicts_with: [], reason: 'x' });
  expect(first.runtime.last.call('scope', { files: [], conflicts_with: [], reason: 'y' })).toBe('Already reported.');
  expect((await first.scope).reason).toBe('x');
  const none = await run();
  none.runtime.last.emit({ type: 'idle' });
  await expect(none.scope).rejects.toThrow('no estimate');
  const down = await run();
  down.runtime.last.emit({ type: 'error', message: 'no login' });
  await expect(down.scope).rejects.toThrow('no login');
});

test('the instructions are those of a folder where the card is in one', async () => {
  const repo = (await run()).runtime.last.spec.system;
  const folder = (await run({ folder: true })).runtime.last.spec.system;
  expect(folder).not.toBe(repo);
});
