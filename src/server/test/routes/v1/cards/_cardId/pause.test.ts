import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();
const code = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];

test('pause, resume and start-at are refused for a card they do not fit, a wrong body, or an unknown card', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  expect((await server.send('POST', `/api/v1/cards/${c.id}/pause`)).status).toBe(400);
  expect(await code(await server.send('POST', `/api/v1/cards/${c.id}/pause`, { safePoint: 'yes' }))).toEqual([400, 'invalid']);
  expect((await server.send('POST', `/api/v1/cards/${c.id}/resume`)).status).toBe(400);
  expect(await code(await server.send('POST', `/api/v1/cards/${c.id}/start-at`, { at: 5 }))).toEqual([400, 'invalid']);
  expect(await code(await server.send('POST', '/api/v1/cards/nope/resume'))).toEqual([404, 'unknownCard']);
});

test('the old act route no longer takes them', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  for (const action of ['pause', 'resume', 'snooze', 'wake', 'startAt'])
    expect(await code(await server.send('POST', `/api/c/${server.shop().id}/cards/${c.id}/act`, { action }))).toEqual([400, 'invalid']);
});
