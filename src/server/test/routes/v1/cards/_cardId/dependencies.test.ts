import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();
const code = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];

test('an arrow is drawn from one card to another and removed again', async () => {
  const [a, b] = [server.shop().board.create({ title: 'A', x: 0, y: 0 }), server.shop().board.create({ title: 'B', x: 300, y: 0 })];
  expect((await server.send('POST', `/api/v1/cards/${a.id}/dependencies`, { to: b.id })).status).toBe(204);
  expect(server.shop().board.manualDependencies().map(([from, to]) => [from, to])).toEqual([[a.id, b.id]]);
  expect(await code(await server.send('POST', `/api/v1/cards/${b.id}/dependencies`, { to: a.id }))).toEqual([400, 'dependencyCycle']);
  expect((await server.send('DELETE', `/api/v1/cards/${a.id}/dependencies/${b.id}`)).status).toBe(204);
  expect(server.shop().board.manualDependencies()).toEqual([]);
});

test('refused: an unknown card on either end', async () => {
  const a = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  expect(await code(await server.send('POST', '/api/v1/cards/nope/dependencies', { to: a.id }))).toEqual([404, 'unknownCard']);
  expect(await code(await server.send('POST', `/api/v1/cards/${a.id}/dependencies`, { to: 'nope' }))).toEqual([400, 'unknownCard']);
});
