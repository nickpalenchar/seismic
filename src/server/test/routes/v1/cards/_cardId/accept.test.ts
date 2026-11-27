import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();
const code = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
const post = (card: string, path: string, body?: unknown) => server.send('POST', `/api/v1/cards/${card}/${path}`, body);

test('a card that is no proposal is refused, as is a body of the wrong kind', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  expect(await code(await post(c.id, 'dismiss'))).toEqual([400, 'notProposal']);
  expect(await code(await post(c.id, 'accept', { start: 'no' }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'merge', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'revise', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'discuss', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'build', { agent: 'opus' }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'prototype', { text: 5 }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'build-prototype', { workstream: 5 }))).toEqual([400, 'invalid']);
});

test('an unknown card is a 404 on each of them', async () => {
  for (const path of ['accept', 'unaccept', 'dismiss-duplicate', 'approve-merge', 'separate', 'dismiss', 'keep', 'unbuild', 'stay-here', 'split-off', 'plan-doc', 'park', 'unpark', 'drop', 'discard', 'build', 'prototype', 'build-prototype'])
    expect(await code(await post('nope', path))).toEqual([404, 'unknownCard']);
  for (const path of ['merge', 'revise', 'discuss']) expect(await code(await post('nope', path, { text: 'x', with: 'y' }))).toEqual([404, 'unknownCard']);
});
