import { describe, expect, test } from 'bun:test';
import { waitsOn } from './queue';
import type { Item } from './types';

const card = (id: string, extra: Partial<Item> = {}) => ({ id, state: 'planned', ...extra }) as Item;

describe('waitsOn', () => {
  test('an arrow the owner drew to a card at work holds nothing, yet still counts as a wait with anyArrow', () => {
    const left = card('left');
    const right = card('right', { state: 'working', plan: { manualDependsOn: ['left'] } } as Partial<Item>);
    expect(waitsOn(right, 'left', [left, right])).toBe(false);
    expect(waitsOn(right, 'left', [left, right], true)).toBe(true);
  });
});
