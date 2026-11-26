import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../../../helpers/chatServer';

const server = useChatServer();

test('waiting on a card stops once, and an exchange of another chat or an unknown chat leaves it', async () => {
  const { board } = server.shop();
  const chat = board.chat();
  const exchange = board.addTalk('when it is done', '');
  board.waitTalk(exchange, [{ card: 'K1', title: 'A card', state: 'done', then: 'tell me' }]);
  const url = (c: number) => `/api/v1/chats/${c}/exchanges/${exchange}/unwait`;
  const other = board.newChat();
  expect(await (await server.send('POST', url(other), { card: 'K1' })).json()).toEqual({ stopped: false });
  expect(board.waitingTalk()).toHaveLength(1);
  expect(await (await server.send('POST', url(chat), { card: 'K1' })).json()).toEqual({ stopped: true });
  expect(board.waitingTalk()).toHaveLength(0);
  expect(await (await server.send('POST', url(chat), { card: 'K1' })).json()).toEqual({ stopped: false });
  expect((await server.send('POST', url(999999), { card: 'K1' })).status).toBe(404);
});
