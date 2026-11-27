import { expect, test } from 'bun:test';
import { BadRequest } from '../../board';
import { HintsService } from '../../services/hintsService';
import { Store } from '../../store';

const hints = () => new HintsService(new Store(':memory:').orm);

test('no hint is seen at first, and one marked stays seen however often it is marked', () => {
  const service = hints();
  expect(service.getSeenHints()).toEqual([]);
  service.markHintSeen('needs-you');
  service.markHintSeen('needs-you');
  service.markHintSeen('review-pr');
  expect(service.getSeenHints().sort()).toEqual(['needs-you', 'review-pr']);
});

test('a hint the registry does not list is refused and not stored', () => {
  const service = hints();
  expect(() => service.markHintSeen('made-up')).toThrow(BadRequest);
  expect(service.getSeenHints()).toEqual([]);
});

test('a reset brings every hint back and says how many were seen', () => {
  const service = hints();
  service.markHintSeen('cite');
  service.markHintSeen('dep');
  expect(service.resetHints()).toBe(2);
  expect(service.getSeenHints()).toEqual([]);
  expect(service.resetHints()).toBe(0);
});

test('a stored id the registry no longer lists is not reported', () => {
  const store = new Store(':memory:');
  store.db.run("INSERT INTO seen_hints (id, seen_at) VALUES ('retired-hint', '2026-11-27')");
  const service = new HintsService(store.orm);
  service.markHintSeen('cite');
  expect(service.getSeenHints()).toEqual(['cite']);
});
