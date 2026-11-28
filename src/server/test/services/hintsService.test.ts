import { expect, test } from 'bun:test';
import { BadRequest } from '../../board';
import { HintsService } from '../../services/hintsService';
import { Store } from '../../store';

const hints = () => new HintsService(new Store(':memory:').hintRepository);

test('no hint is seen at first, and one marked stays seen however often it is marked', async () => {
  const service = hints();
  expect(await service.getSeenHints()).toEqual([]);
  await service.markHintSeen('needs-you');
  await service.markHintSeen('needs-you');
  await service.markHintSeen('review-pr');
  expect((await service.getSeenHints()).sort()).toEqual(['needs-you', 'review-pr']);
});

test('a hint the registry does not list is refused and not stored', async () => {
  const service = hints();
  await expect(service.markHintSeen('made-up')).rejects.toThrow(BadRequest);
  expect(await service.getSeenHints()).toEqual([]);
});

test('a reset brings every hint back and says how many were seen', async () => {
  const service = hints();
  await service.markHintSeen('cite');
  await service.markHintSeen('dep');
  expect(await service.resetHints()).toBe(2);
  expect(await service.getSeenHints()).toEqual([]);
  expect(await service.resetHints()).toBe(0);
});

test('a stored id the registry no longer lists is not reported', async () => {
  const store = new Store(':memory:');
  store.db.run("INSERT INTO seen_hints (id, seen_at) VALUES ('retired-hint', '2026-11-27')");
  const service = new HintsService(store.hintRepository);
  await service.markHintSeen('cite');
  expect(await service.getSeenHints()).toEqual(['cite']);
});
