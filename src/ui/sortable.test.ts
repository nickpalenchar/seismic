import { describe, expect, test } from 'bun:test';
import { landing, moved } from './sortable';

describe('sortable', () => {
  test('a dropped row takes its new place, within the list', () => {
    expect(moved(['a', 'b', 'c', 'd'], 'd', -2)).toEqual(['a', 'd', 'b', 'c']);
    expect(moved(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moved(['a', 'b', 'c'], 'b', 0)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'b', 'c']);
  });

  test('the dragged row lands past each row whose middle its edge has passed, no farther than its reach', () => {
    
    const mids = [10, 30, 50, 70];
    const free = { earlier: 3, later: 3 };
    const at = (from: number, dy: number, reach = free) => landing(mids, from, from * 20 + dy, from * 20 + 20 + dy, reach);
    expect(at(1, 0)).toBe(1);
    expect(at(1, 9)).toBe(1);
    expect(at(1, 11)).toBe(2);
    expect(at(1, 40)).toBe(3);
    expect(at(2, -40)).toBe(0);
    expect(at(1, 40, { earlier: 1, later: 1 })).toBe(2);
    expect(at(3, -60, { earlier: 0, later: 0 })).toBe(3);
    
    expect(landing([50, 110], 0, 20, 120, { earlier: 0, later: 1 })).toBe(1);
  });
});
