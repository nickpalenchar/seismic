import { describe, expect, test } from 'bun:test';
import { drawnWaits, waitsOn } from './queue';
import type { Item } from './types';

const card = (id: string, extra: Partial<Item> = {}) => ({ id, state: 'planned', ...extra }) as Item;

describe('waitsOn', () => {
  test('an arrow the owner drew to a card at work holds nothing, yet still counts as a wait with anyArrow', () => {
    const left = card('left');
    const right = card('right', { state: 'working', plan: { manualDependsOn: ['left'] } } as Partial<Item>);
    expect(waitsOn(right, 'left', [left, right])).toBe(false);
    expect(waitsOn(right, 'left', [left, right], true)).toBe(true);
  });

  test('a card snoozed until another waits for it with anyArrow', () => {
    const b = card('b');
    const a = card('a', { state: 'working', hold: { reason: 'snoozed', since: '', on: { card: 'b' } } } as unknown as Partial<Item>);
    expect(waitsOn(a, 'b', [a, b])).toBe(false);
    expect(waitsOn(a, 'b', [a, b], true)).toBe(true);
  });
});

describe('parked cards in waits', () => {
  const parked = { hold: { reason: 'parkingLot', since: 'x' } } as Partial<Item>;
  test('an arrow from a parked card holds nothing, and holds again once unparked', () => {
    const b = card('b', { plan: { manualDependsOn: ['a'] } as Item['plan'] });
    expect(drawnWaits(b, [card('a', parked), b])).toEqual([]);
    expect(drawnWaits(b, [card('a'), b])).toEqual(['a']);
  });
  test('a queue wait behind a parked card is not followed', () => {
    const b = card('b', { queue: { behind: ['a'], reason: '' } as Item['queue'] });
    expect(waitsOn(b, 'a', [card('a', parked), b])).toBe(false);
    expect(waitsOn(b, 'a', [card('a'), b])).toBe(true);
  });
});
