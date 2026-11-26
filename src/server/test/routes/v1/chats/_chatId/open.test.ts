import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();

test('going back to an earlier chat makes it the one new words go into, and drops a chat left empty', async () => {
  const { board } = server.shop();
  const first = board.chat();
  board.addTalk('first', '');
  const second = board.newChat();
  board.addTalk('second', '');
  const empty = board.newChat();
  expect(board.chat()).toBe(empty);
  const res = await server.send('POST', `/api/v1/chats/${first}/open`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ chat: first });
  expect(board.chat()).toBe(first);
  expect(board.hasChat(second)).toBe(true);
  expect(board.hasChat(empty)).toBe(false);
});

test('a chat that does not exist is a 404', async () => {
  expect((await server.send('POST', '/api/v1/chats/999999/open')).status).toBe(404);
});
