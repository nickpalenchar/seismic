import { expect, test } from 'bun:test';
import type { Item, PoolHost } from '../core/types';
import { atWorkOn, dotsLayout, hostSpots } from './workstations';

const card = (id: string, more: Partial<Item> = {}) => ({ id, short: id, title: id, body: '', state: 'working', ...more }) as Item;
const host = (more: Partial<PoolHost>): PoolHost => ({ name: 'here', worktrees: true, slots: 1, total: 1, cards: [], busy: [], workstations: [], ...more });

test('a waiting card keeps its worktree dot, and its released slot shows as an empty circle', () => {
  const h = host({ cards: ['a'], busy: [], workstations: [{ path: '/w/a', card: 'a' }] });
  const spots = hostSpots(h, [card('a', { state: 'waiting' })]);
  expect(spots.map((s) => s?.card)).toEqual(['a', undefined]);
});

test('a hidden card whose worker is busy takes a slot: no empty circle', () => {
  const h = host({ cards: ['a'], busy: ['a'], workstations: [{ path: '/w/a', card: 'a' }] });
  const spots = hostSpots(h, [card('a', { queue: { workstation: 'slots' } as Item['queue'] })]);
  expect(spots).toEqual([]);
});

test('a card whose code review agent is at work counts at work beside the workers in a turn', () => {
  expect(atWorkOn(host({ busy: ['a'], reviewing: ['b'] }))).toBe(2);
  expect(atWorkOn(host({ busy: ['a'] }))).toBe(1);
});

test('an idea whose agent is at work has a dot after the cards, takes no slot and counts at work', () => {
  const h = host({ slots: 2, total: 2, cards: ['a'], busy: ['a'], exploring: ['i'], workstations: [{ path: '/w/a', card: 'a' }] });
  const spots = hostSpots(h, [card('a'), card('i', { state: 'idea' })]);
  expect(spots.map((s) => s?.card)).toEqual(['a', 'i', undefined]);
  expect(atWorkOn(h)).toBe(2);
  // in clones, after every clone
  const clones = host({ worktrees: false, exploring: ['i'], workstations: [{ path: '/c/1' }] });
  expect(hostSpots(clones, [card('i', { state: 'idea' })]).map((s) => s?.card)).toEqual([undefined, 'i']);
  // a parked idea's agent shows no dot
  expect(hostSpots(clones, [card('i', { state: 'idea', hold: { reason: 'parkingLot' } as Item['hold'] })]).map((s) => s?.card)).toEqual([undefined]);
});

test('a machine\'s dots go into one row up to 5, two up to 12, three up to 18, then a bar', () => {
  expect(dotsLayout(5)).toEqual({ rows: 1, cols: 5 });
  expect(dotsLayout(6)).toEqual({ rows: 2, cols: 3 });
  expect(dotsLayout(11)).toEqual({ rows: 2, cols: 6 });
  expect(dotsLayout(12)).toEqual({ rows: 2, cols: 6 });
  expect(dotsLayout(13)).toEqual({ rows: 3, cols: 5 });
  expect(dotsLayout(18)).toEqual({ rows: 3, cols: 6 });
  expect(dotsLayout(19)).toBe('bar');
});
