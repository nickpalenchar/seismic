import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();

test('answers that waited unread in the chat are read, all or the exchanges named', async () => {
  const { board } = server.shop();
  const chat = board.chat();
  const one = board.addTalk('one', '');
  const two = board.addTalk('two', '');
  board.answerTalk(one, 'a', 'koordinator');
  board.answerTalk(two, 'b', 'koordinator');
  const unread = () => board.talk().filter((x) => x.unread).map((x) => x.id);
  expect(unread()).toEqual([one, two]);
  expect((await server.send('POST', `/api/v1/chats/${chat}/read`, { ids: [one] })).status).toBe(200);
  expect(unread()).toEqual([two]);
  expect((await server.send('POST', `/api/v1/chats/${chat}/read`)).status).toBe(200);
  expect(unread()).toEqual([]);
});

test('ids that are no list of numbers are refused, and a chat that does not exist is a 404', async () => {
  const chat = server.shop().board.chat();
  const res = await server.send('POST', `/api/v1/chats/${chat}/read`, { ids: 'all' });
  expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([400, 'invalid']);
  expect((await server.send('POST', '/api/v1/chats/999999/read', {})).status).toBe(404);
});
