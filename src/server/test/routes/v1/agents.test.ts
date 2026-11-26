import { expect, test } from 'bun:test';
import { useChatServer } from '../../helpers/chatServer';

const server = useChatServer();

test('a harness that has no catalog is refused, and a Seismic without a configuration has none to read', async () => {
  const refused = await server.send('GET', '/api/v1/agents?models=claude');
  expect([refused.status, ((await refused.json()) as { code: string }).code]).toEqual([400, 'invalid']);
  const none = await server.send('GET', '/api/v1/agents?models=codex,agy');
  expect([none.status, ((await none.json()) as { code: string }).code]).toEqual([404, 'noConfiguration']);
});
