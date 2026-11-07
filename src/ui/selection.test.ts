import { expect, test } from 'bun:test';
import { addAll, markable, movesWith, shifted, toggle } from './selection';

test('a workstream is marked as its plan', () => {
  expect(markable({ id: 'w1', parent: 'p' })).toBe('p');
  expect(markable({ id: 'c' })).toBe('c');
});

test('Shift + click takes a card in and out; a lasso adds what it caught once', () => {
  expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
  expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  expect(addAll(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
});

test('dragging a marked card moves the others with it, an unmarked one moves alone', () => {
  expect(movesWith(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  expect(movesWith(['a', 'b'], 'x')).toEqual([]);
  expect(
    shifted(
      [
        { id: 'a', start: { x: 10, y: 20 } },
        { id: 'b', start: { x: -5, y: 0 } },
      ],
      { x: 3.4, y: -7.6 },
    ),
  ).toEqual({ a: { x: 13, y: 12 }, b: { x: -2, y: -8 } });
});
