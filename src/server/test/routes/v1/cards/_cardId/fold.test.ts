import { expect, test } from 'bun:test';
import { useChatServer } from '../../../../helpers/chatServer';

const server = useChatServer();
const code = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
const post = (card: string, path: string, body?: unknown) => server.send('POST', `/api/v1/cards/${card}/${path}`, body);

test('what a body must hold is checked before the action runs', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  expect(await code(await post(c.id, 'fold', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'edit-held', { body: 5 }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'hand-off', {}))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'code-review', { agent: 'opus' }))).toEqual([400, 'invalid']);
  expect(await code(await post(c.id, 'code-review/items/x/reopen'))).toEqual([400, 'invalid']);
});

test('an unknown card is a 404 on each of them', async () => {
  for (const path of ['push-main', 'keep-main', 'push-changes', 'code-review', 'code-review/stop', 'code-review/skip', 'code-review/items/1/reopen'])
    expect(await code(await post('nope', path))).toEqual([404, 'unknownCard']);
  expect(await code(await post('nope', 'fold', { land: true }))).toEqual([404, 'unknownCard']);
});

test('the old act route no longer takes them', async () => {
  const c = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  for (const action of ['pushMain', 'keepMain', 'pushChanges', 'fold', 'editHeld', 'codeReview', 'stopCodeReview', 'skipCodeReview', 'handOff', 'reopenReviewItem'])
    expect(await code(await server.send('POST', `/api/c/${server.shop().id}/cards/${c.id}/act`, { action }))).toEqual([400, 'invalid']);
});
