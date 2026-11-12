import { expect, test } from 'bun:test';
import type { Item, PoolHost } from '../core/types';
import { atWorkOn, hostSpots } from './parts';

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

test('a card whose code review runs counts at work beside the workers in a turn', () => {
  const h = host({ cards: ['a', 'b', 'c'], busy: ['a'], workstations: [{ path: '/w/a', card: 'a' }, { path: '/w/b', card: 'b' }, { path: '/w/c', card: 'c' }] });
  const reviewing = { codeReview: { state: 'running' } } as Item['review'];
  expect(atWorkOn(h, [card('a'), card('b', { state: 'waiting', review: reviewing }), card('c', { state: 'waiting' })])).toBe(2);
});
