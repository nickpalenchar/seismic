import { expect, test } from 'bun:test';
import { useChatServer } from '../../../helpers/chatServer';

const server = useChatServer();
const patch = (chat: number | string, body: unknown) => server.send('PATCH', `/api/v1/chats/${chat}`, body);
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];

test('a delayed model save changes its own chat after another chat opens, answered with the chat', async () => {
  const { board } = server.shop();
  const original = board.chat();
  board.addTalk('original topic', 'answer');
  const current = board.newChat();
  board.setChatModel('opus');
  const res = await patch(original, { model: 'sonnet' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ chat: { id: original, model: 'sonnet' } });
  expect(board.chatModel(original)).toBe('sonnet');
  expect(board.chatModel(current)).toBe('opus');
  expect(board.chat()).toBe(current);
  expect(await (await patch(original, { model: null })).json()).toEqual({ chat: { id: original, model: null } });
  expect(board.chatModel(original)).toBeUndefined();
  expect(board.chatModel(current)).toBe('opus');
});

test('a model that is none of the known ones is refused, and a chat that does not exist is a 404', async () => {
  const { board } = server.shop();
  const chat = board.chat();
  expect(await codeOf(await patch(chat, { model: 'gpt' }))).toEqual([400, 'invalid']);
  expect(board.chatModel(chat)).toBeUndefined();
  expect((await patch(chat, { model: 'codex:another-model' })).status).toBe(200);
  expect(board.chatModel(chat)).toBe('codex:another-model');
  expect(await codeOf(await patch(999_999, { model: 'opus' }))).toEqual([404, 'unknownChat']);
  expect(await codeOf(await patch('x', { model: 'opus' }))).toEqual([404, 'unknownChat']);
});

test('a chat of another project is found through the chat, not through a project in the URL', async () => {
  const site = server.website();
  const chat = site.board.chat();
  expect((await patch(chat, { model: 'haiku' })).status).toBe(200);
  expect(site.board.chatModel(chat)).toBe('haiku');
  expect(server.shop().board.chatModel()).toBeUndefined();
});
