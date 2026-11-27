import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();
const code = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
const post = (card: string, path: string, body?: unknown, method = 'POST') => server.send(method, `/api/v1/cards/${card}/${path}`, body);

test('what a body must hold is checked before the action runs', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  expect(await code(await post(c.id, 'release', { now: 'yes' }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'reorder', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'reorder', { earlier: true, places: 1.5 }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'unsay', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'ask', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'consult', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'page-tags', { dimension: 'x', values: [1] }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'share', { demo: 'one' }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'share', { add: 'yes' }))).toEqual([400, 'invalid']);
});

test('an unknown card is a 404 on each of them', async () => {
  for (const path of ['undo', 'name', 'arrange', 'take-workstation', 'keep-workstation', 'as-idea', 'release']) expect(await code(await post('nope', path))).toEqual([404, 'unknownCard']);
  expect(await code(await post('nope', 'reorder', { earlier: true }))).toEqual([404, 'unknownCard']);
  expect(await code(await post('nope', 'unsay', { id: 1 }))).toEqual([404, 'unknownCard']);
  expect(await code(await post('nope', 'ask', { text: 'x' }))).toEqual([404, 'unknownCard']);
  expect(await code(await post('nope', 'page-tags', { dimension: 'x', values: [] }))).toEqual([404, 'unknownCard']);
  expect(await code(await post('nope', 'share', {}))).toEqual([404, 'unknownCard']);
  expect(await code(await post('nope', 'share', {}, 'DELETE'))).toEqual([404, 'unknownCard']);
});
