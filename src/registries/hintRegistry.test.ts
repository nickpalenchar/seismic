import { expect, test } from 'bun:test';
import { HINT_REGISTRY, isHintId } from './hintRegistry';

test('every hint has a unique id and a description', () => {
  const ids = HINT_REGISTRY.map((hint) => hint.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const hint of HINT_REGISTRY) {
    expect(hint.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(hint.description.length).toBeGreaterThan(0);
  }
});

test('only registered ids are hint ids', () => {
  expect(isHintId('needs-you')).toBe(true);
  expect(isHintId('nothing-of-the-kind')).toBe(false);
  expect(isHintId('constructor')).toBe(false);
});
