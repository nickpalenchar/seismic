import { expect, test } from 'bun:test';
import type { Item } from '../../../../../../core/types';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();
const code = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];

test('a card is snoozed and woken, each answered with the card', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  const until = new Date(Date.now() + 3_600_000).toISOString();
  const snoozed = await server.send('POST', `/api/v1/cards/${c.id}/snooze`, { until });
  expect(snoozed.status).toBe(200);
  expect(((await snoozed.json()) as { card: Item }).card.id).toBe(c.id);
  expect(server.shop().board.item(c.id)?.hold?.reason).toBe('snoozed');
  expect((await server.send('POST', `/api/v1/cards/${c.id}/wake`)).status).toBe(200);
  expect(server.shop().board.item(c.id)?.hold?.reason).toBeUndefined();
  expect((await code(await server.send('POST', `/api/v1/cards/${c.id}/wake`)))[0]).toBe(400);
});

test('refused: no time, a time past, an unknown card', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  expect(await code(await server.send('POST', `/api/v1/cards/${c.id}/snooze`, {}))).toEqual([400, 'invalid']);
  expect((await server.send('POST', `/api/v1/cards/${c.id}/snooze`, { until: new Date(Date.now() - 3_600_000).toISOString() })).status).toBe(400);
  expect(await code(await server.send('POST', '/api/v1/cards/nope/snooze', { until: 'x' }))).toEqual([404, 'unknownCard']);
});
