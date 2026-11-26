import { expect, test } from 'bun:test';
import type { ChatElsewhere } from '../../../../core/types';
import { useChatServer } from '../../helpers/chatServer';

const server = useChatServer();

test('every project\'s chats with something said, the latest first, each with its project\'s name', async () => {
  const shop = server.shop();
  const website = server.website();
  const first = shop.board.chat();
  shop.board.addTalk('shop words', '');
  website.board.addTalk('site words', '');
  const res = await server.send('GET', '/api/v1/chats');
  expect(res.status).toBe(200);
  const { chats } = (await res.json()) as { chats: ChatElsewhere[] };
  expect(chats.map((chat) => [chat.project, chat.projectName, chat.title])).toEqual([
    [website.id, website.board.project.name, 'site words'],
    [shop.id, shop.board.project.name, 'shop words'],
  ]);
  expect(chats.some((chat) => chat.id === first)).toBe(true);
});

test('a new chat on the project, the one without words reused, and an unknown project refused', async () => {
  const shop = server.shop();
  const before = shop.board.chat();
  const empty = (await (await server.send('POST', '/api/v1/chats', { project: shop.id })).json()) as { chat: number };
  expect(empty.chat).toBe(before);
  shop.board.addTalk('words', '');
  const made = (await (await server.send('POST', '/api/v1/chats', { project: shop.id })).json()) as { chat: number };
  expect(made.chat).not.toBe(before);
  expect(shop.board.chat()).toBe(made.chat);
  expect((await server.send('POST', '/api/v1/chats', { project: 'nope' })).status).toBe(404);
  expect((await server.send('POST', '/api/v1/chats', {})).status).toBe(404);
});
