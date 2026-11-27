import { expect, test } from 'bun:test';
import { HintRepository } from '../../repositories/hintRepository';
import { Store } from '../../store';

test('a hint is stored once, however many callers find-or-create it at the same time', async () => {
  const hints = new HintRepository(new Store(':memory:').orm);
  const [first, second] = await Promise.all([hints.findOrCreate('cite', { id: 'cite' }), hints.findOrCreate('cite', { id: 'cite' })]);
  expect(second.seenAt).toBe(first.seenAt);
  expect(await hints.findMany({})).toHaveLength(1);
});

test('records come back frozen and as the table stores them', async () => {
  const store = new Store(':memory:');
  store.db.run("INSERT INTO seen_hints (id, seen_at) VALUES ('dep', '2026-11-27T00:00:00.000Z')");
  const hint = await new HintRepository(store.orm).find('dep');
  expect(hint?.seenAt).toBe('2026-11-27T00:00:00.000Z');
  expect(Object.isFrozen(hint)).toBe(true);
});
