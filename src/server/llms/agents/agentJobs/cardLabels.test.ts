import { expect, test } from 'bun:test';
import { FakeRuntime } from '../../../testing';
import { judgeLabels } from './cardLabels';

const run = (over: Partial<Parameters<typeof judgeLabels>[0]> = {}) => {
  const runtime = new FakeRuntime();
  const judged = judgeLabels({ runtime, cwd: '/repo', asked: ['category'], title: 'Export readings', body: 'As CSV.', ...over });
  return { runtime, judged };
};

test('labels are judged by a read-only session of the chores role that may do without screenshots', () => {
  const { runtime } = run({ images: ['/img/a.png'] });
  expect(runtime.last.spec).toMatchObject({ cwd: '/repo', role: 'chores', permission: 'readOnly', needs: { images: 'optional' } });
  expect(runtime.last.inbox).toEqual(["The card's title: Export readings\n\nIts text:\nAs CSV.\n\nIts screenshots are below."]);
  expect(runtime.last.images).toEqual([['/img/a.png']]);
});

test('the brief leaves out what the card lacks', () => {
  const { runtime } = run({ body: '' });
  expect(runtime.last.inbox).toEqual(["The card's title: Export readings"]);
});

test('a failed session settles with no labels', async () => {
  const { runtime, judged } = run();
  runtime.last.emit({ type: 'error', message: 'down' });
  expect(await judged).toEqual({});
});
