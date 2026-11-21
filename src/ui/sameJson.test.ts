import { expect, test } from 'bun:test';
import { sameJson } from './sameJson';

test('the same content is the same, in any key order; any difference is not', () => {
  expect(sameJson({ a: 1, b: [1, { c: 'x' }], d: null }, { d: null, b: [1, { c: 'x' }], a: 1 })).toBe(true);
  expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  expect(sameJson({ a: [] }, { a: {} })).toBe(false);
  expect(sameJson({ a: null }, { a: {} })).toBe(false);
  expect(sameJson('1', 1)).toBe(false);
});
