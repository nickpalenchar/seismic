import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();

test('an answer is refused for a card that asks nothing, with no text, or for a card that does not exist', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  const code = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
  expect(await code(await server.send('POST', `/api/v1/cards/${c.id}/answer`, { text: 'x' }))).toEqual([400, 'noQuestion']);
  expect(await code(await server.send('POST', `/api/v1/cards/${c.id}/answer`, { picks: ['a'] }))).toEqual([400, 'invalid']);
  expect(await code(await server.send('POST', '/api/v1/cards/nope/answer', { text: 'x' }))).toEqual([404, 'unknownCard']);
});
