import { expect, test } from 'bun:test';
import { FakeRuntime, heard } from '../../../helpers/testing';
import { judgeCardLabels } from '../../../../llms/agents/agentJobs/judgeCardLabels';

const run = async (over: Partial<Parameters<typeof judgeCardLabels>[0]> = {}) => {
  const runtime = new FakeRuntime();
  const judged = judgeCardLabels({ runtime, cwd: '/repo', asked: ['category'], title: 'Export readings', body: 'As CSV.', ...over });
  await heard();
  return { runtime, judged };
};

test('labels are judged by a read-only session of the chores role that may do without screenshots', async () => {
  const { runtime } = await run({ images: ['/img/a.png'] });
  expect(runtime.last.spec).toMatchObject({ cwd: '/repo', role: 'chores', permission: 'readOnly', checkModel: expect.any(Function) });
  expect(runtime.last.inbox).toEqual(["The card's title: Export readings\n\nIts text:\nAs CSV.\n\nIts screenshots are below."]);
  expect(runtime.last.images).toEqual([['/img/a.png']]);
});

test('the brief leaves out what the card lacks', async () => {
  const { runtime } = await run({ body: '' });
  expect(runtime.last.inbox).toEqual(["The card's title: Export readings"]);
});

test('a failed session settles with no labels', async () => {
  const { runtime, judged } = await run();
  runtime.last.emit({ type: 'error', message: 'down' });
  expect(await judged).toEqual({});
});
