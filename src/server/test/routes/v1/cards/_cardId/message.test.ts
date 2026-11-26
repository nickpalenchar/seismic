import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();

test('words to a card are refused when they are empty, no text or for a card that does not exist', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  const code = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
  expect(await code(await server.send('POST', `/api/v1/cards/${c.id}/message`, { text: '' }))).toEqual([400, 'emptyText']);
  expect(await code(await server.send('POST', `/api/v1/cards/${c.id}/message`, {}))).toEqual([400, 'invalid']);
  expect(await code(await server.send('POST', '/api/v1/cards/nope/message', { text: 'hi' }))).toEqual([404, 'unknownCard']);
});

test('the old act route no longer takes a message', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  const res = await server.send('POST', `/api/c/${server.shop().id}/cards/${c.id}/act`, { action: 'message', text: 'hi' });
  expect(res.status).toBe(400);
});
