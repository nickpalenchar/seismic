import { expect, test } from 'bun:test';
import { FakeRuntime, heard } from '../../../helpers/testing';
import { nameCard } from '../../../../llms/agents/agentJobs/nameCard';

const run = async (over: Partial<Parameters<typeof nameCard>[0]> = {}) => {
  const runtime = new FakeRuntime();
  const named = nameCard({ runtime, cwd: '/repo', language: 'English', asked: [], task: 'Export the readings as CSV.', ...over });
  await heard();
  return { runtime, named };
};

test('a card is named by a read-only session of the chores role that may do without its screenshots', async () => {
  const { runtime, named } = await run({ images: ['/img/a.png'] });
  expect(runtime.last.spec).toMatchObject({ cwd: '/repo', role: 'chores', permission: 'readOnly', checkModel: expect.any(Function) });
  expect(runtime.last.inbox).toEqual(['The task:\nExport the readings as CSV.']);
  expect(runtime.last.images).toEqual([['/img/a.png']]);
  expect(runtime.last.call('title', { title: '  Export   readings\nas CSV ' })).toContain('Recorded');
  expect(await named).toEqual({ title: 'Export readings as CSV', labels: {} });
});

test('the title is named in the language given, and the owner’s preferences follow the instructions', async () => {
  const { runtime } = await run({ language: 'German', preferences: 'Titles are short.' });
  expect(runtime.last.spec.system).toContain('in German unless an explicit standing preference');
  expect(runtime.last.spec.system.endsWith('\n\nTitles are short.')).toBe(true);
});

test('a task that is in the screenshots alone says so', async () => {
  const { runtime } = await run({ task: '  ', images: ['/img/a.png'] });
  expect(runtime.last.inbox).toEqual(['The task is in the screenshots alone (shown below).']);
});

test('a second answer is refused, and a failed session settles with the placeholder title', async () => {
  const { runtime, named } = await run();
  runtime.last.call('title', { title: 'First' });
  expect(runtime.last.call('title', { title: 'Second' })).toBe('Already named.');
  expect((await named).title).toBe('First');
  const failed = await run();
  failed.runtime.last.emit({ type: 'error', message: 'down' });
  expect(await failed.named).toEqual({ title: '…', labels: {} });
});
