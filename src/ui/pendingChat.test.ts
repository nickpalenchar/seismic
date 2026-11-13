import { expect, test } from 'bun:test';
import { echoed } from './pendingChat';

test('identical sends settle independently even when their echoes arrive in reverse order', () => {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const pending = [{ id: first, text: 'same' }, { id: second, text: 'same' }];
  const echoes = [{ requestId: second, said: 'same' }];
  expect(pending.filter((entry) => !echoed(entry.id, echoes))).toEqual([pending[0]!]);
  echoes.push({ requestId: first, said: 'same' });
  expect(pending.filter((entry) => !echoed(entry.id, echoes))).toEqual([]);
  expect(echoed(first, [{ requestId: undefined }])).toBe(false);
});
