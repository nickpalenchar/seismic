import { expect, test } from 'bun:test';
import type { Item, PoolHost } from '../core/types';
import { atWorkOn, dotsLayout, hostSpots } from './workstations';

const card = (id: string, more: Partial<Item> = {}) => ({ id, short: id, title: id, body: '', state: 'working', ...more }) as Item;
const host = (more: Partial<PoolHost>): PoolHost => ({ name: 'here', worktrees: true, slots: 1, total: 1, cards: [], busy: [], workstations: [], ...more });

test('a waiting card uses one position in a capped worktree display', () => {
  const waiting = { path: '/w/waiting', card: 'waiting' };
  const h = host({ slots: 10, total: 10, workstations: [waiting] });
  const review = card('waiting', { state: 'waiting' });
  expect(hostSpots(h, [review])).toStrictEqual([waiting, ...Array(9).fill(undefined)]);

  const working = { path: '/w/working', card: 'working' };
  const mixed = { ...h, cards: ['working'], busy: ['working'], workstations: [waiting, working] };
  const spots = hostSpots(mixed, [review, card('working')]);
  expect(spots).toStrictEqual([waiting, working, ...Array(8).fill(undefined)]);
});

test('a hidden card whose worker is busy takes a slot: no empty circle', () => {
  const h = host({ cards: ['a'], busy: ['a'], workstations: [{ path: '/w/a', card: 'a' }] });
  const spots = hostSpots(h, [card('a', { queue: { workstation: 'slots' } as Item['queue'] })]);
  expect(spots).toEqual([]);
});

test('a snoozed card with a worktree uses a position even after its turn ends', () => {
  const h = host({ workstations: [{ path: '/w/a', card: 'a' }] });
  expect(hostSpots(h, [card('a', { hold: { reason: 'snoozed', by: 'owner', since: '2026-11-18T12:00:00Z' } })])).toStrictEqual([]);
});

test('busy worktrees have priority when more cards hold worktrees than the cap', () => {
  const waiting = { path: '/w/waiting', card: 'waiting' };
  const working = { path: '/w/working', card: 'working' };
  const h = host({ cards: ['working'], busy: ['working'], workstations: [waiting, working] });
  const items = [card('waiting', { state: 'waiting' }), card('working')];
  expect(hostSpots(h, items)).toEqual([working]);
  expect(hostSpots({ ...h, slots: 0, total: 0, uncapped: true }, items)).toEqual([waiting, working]);
});

test('hidden worktrees reserve space after visible workers', () => {
  const working = { path: '/w/working', card: 'working' };
  const waiting = { path: '/w/waiting', card: 'waiting' };
  const h = host({
    busy: ['working', 'outside'],
    workstations: [waiting, { path: '/w/queued', card: 'queued' }, { path: '/w/snoozed', card: 'snoozed' }, working],
  });
  const items = [
    card('waiting', { state: 'waiting' }),
    card('queued', { queue: { workstation: 'slots' } as Item['queue'] }),
    card('snoozed', { hold: { reason: 'snoozed', by: 'owner', since: '2026-11-18T12:00:00Z' } }),
    card('working'),
  ];
  expect(hostSpots(h, items)).toStrictEqual([working]);
  expect(hostSpots({ ...h, busy: ['working'] }, items)).toStrictEqual([working]);
  expect(hostSpots({ ...h, slots: 4, total: 4 }, items)).toStrictEqual([working]);
  expect(hostSpots({ ...h, slots: 6, total: 6 }, items)).toStrictEqual([waiting, working, undefined]);
});

test('a card whose code review agent is at work counts at work beside the workers in a turn', () => {
  expect(atWorkOn(host({ busy: ['a'], reviewing: ['b'] }))).toBe(2);
  expect(atWorkOn(host({ busy: ['a'] }))).toBe(1);
});

test('an idea whose agent is at work uses an available dot after the worktrees and counts at work', () => {
  const h = host({ slots: 2, total: 2, cards: ['a'], busy: ['a'], exploring: ['i'], workstations: [{ path: '/w/a', card: 'a' }] });
  const spots = hostSpots(h, [card('a'), card('i', { state: 'idea' })]);
  expect(spots.map((s) => s?.card)).toEqual(['a', 'i']);
  expect(hostSpots({ ...h, slots: 1, total: 1 }, [card('a'), card('i', { state: 'idea' })]).map((s) => s?.card)).toEqual(['a']);
  expect(atWorkOn(h)).toBe(2);
  // in clones, after every clone
  const clones = host({ worktrees: false, exploring: ['i'], workstations: [{ path: '/c/1' }] });
  expect(hostSpots(clones, [card('i', { state: 'idea' })]).map((s) => s?.card)).toEqual([undefined, 'i']);
  // on this machine's checkout alone (no workstation of the repository here), the idea is its one dot
  const checkout = host({ worktrees: false, checkout: true, slots: 0, total: 0, exploring: ['i'] });
  expect(hostSpots(checkout, [card('i', { state: 'idea' })]).map((s) => s?.card)).toEqual(['i']);
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
