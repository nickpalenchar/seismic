import { expect, test } from 'bun:test';
import { edgeChipPositions, CHIP_HEIGHT } from './edgeChips';

test('off-screen pointers stack without overlap in a fixed card order', () => {
  const targets = ['c', 'a', 'b'].map((id) => ({ id, b: { x: 100, y: -200, w: 200, h: 100 } }));
  const cam = { x: 0, y: 0, s: 1 }, side = { left: 0, right: 0 };
  const first = edgeChipPositions(targets, cam, side, 800, 600);
  expect(first.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  expect(first.map((p) => p.y)).toEqual([74, 74 + CHIP_HEIGHT, 74 + 2 * CHIP_HEIGHT]);
  expect(edgeChipPositions([...targets].reverse(), cam, side, 800, 600)).toEqual(first);
});

test('a full stack continues in another column when space allows', () => {
  const targets = Array.from({ length: 20 }, (_, n) => ({ id: String(n).padStart(2, '0'), b: { x: 2000, y: 0, w: 200, h: 100 } }));
  const chips = edgeChipPositions(targets, { x: 0, y: 0, s: 1 }, { left: 0, right: 0 }, 800, 600);
  for (const [index, a] of chips.entries()) for (const b of chips.slice(index + 1)) {
    expect(Math.abs(a.x - b.x) >= 300 || Math.abs(a.y - b.y) >= CHIP_HEIGHT).toBe(true);
  }
});

test('pointers on one screen edge touch even when their cards are at different heights', () => {
  const targets = [0, 50, 100].map((y, n) => ({ id: String(n), b: { x: 2000, y, w: 200, h: 100 } }));
  const chips = edgeChipPositions(targets, { x: 0, y: 400, s: 1 }, { left: 0, right: 0 }, 1440, 900);
  expect(chips.map((p) => p.y)).toEqual([500, 530, 560]);
});
