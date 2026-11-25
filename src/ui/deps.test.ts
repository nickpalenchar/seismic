import { expect, test } from 'bun:test';
import type { Item } from '../core/types';
import { depsOf, nearestHandle, settledAmong, waitsAmong, withoutImplied } from './deps';

const card = (id: string, ...behind: string[]) =>
  ({ id, kind: 'task', state: behind.length ? 'planned' : 'working', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', ...(behind.length && { queue: { behind, reason: '' } }) }) as Item;


const items = [card('A'), card('B', 'A'), card('C', 'B'), card('D', 'A', 'B'), card('E')];

test('a waiting card shows what it waits for, over every step', () => {
  const d = depsOf('C', items)!;
  expect([...d.before].sort()).toEqual(['A', 'B']);
  expect(d.after.size).toBe(0);
  expect(d.edges.sort()).toEqual([['A', 'B'], ['B', 'C']]);
});

test('a working card shows everything that waits for it, each wait once, none a chain implies', () => {
  const d = depsOf('A', items)!;
  expect([...d.after].sort()).toEqual(['B', 'C', 'D']);
  expect(d.before.size).toBe(0);
  
  expect(d.edges.sort()).toEqual([['A', 'B'], ['B', 'C'], ['B', 'D']]);
});

test('a wait that a chain of others implies shows no line of its own', () => {
  const all: [string, string][] = [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']];
  expect(withoutImplied(all)).toEqual([['A', 'B'], ['B', 'C'], ['C', 'D']]);
  const hovered = depsOf('D', [card('A'), card('B', 'A'), card('C', 'A', 'B'), card('D', 'A', 'B', 'C')])!;
  expect(hovered.edges.sort()).toEqual([['A', 'B'], ['B', 'C'], ['C', 'D']]);
  expect([...hovered.first].sort()).toEqual(['A B', 'B C', 'C D']);
});

test('a loop keeps all its waits', () => {
  const loop: [string, string][] = [['A', 'B'], ['B', 'C'], ['C', 'A'], ['A', 'C'], ['B', 'A']];
  expect(withoutImplied(loop)).toEqual(loop);
});

test('a card in the middle shows both ways', () => {
  const d = depsOf('B', items)!;
  expect([...d.before]).toEqual(['A']);
  expect([...d.after].sort()).toEqual(['C', 'D']);
  
  expect([...d.first]).toEqual(['A B']);
});

test('a card without waits has none, and cards gone from the project are left out', () => {
  expect(depsOf('E', items)).toBeUndefined();
  expect(depsOf('F', [card('F', 'gone')])).toBeUndefined();
});

test('a hovered card gone from the project, archived under the pointer, has none', () => {
  expect(depsOf('C', items.filter((i) => i.id !== 'C'))).toBeUndefined();
});

test('a loop ends', () => {
  const d = depsOf('X', [card('X', 'Y'), card('Y', 'X')])!;
  expect([...d.before]).toEqual(['Y']);
  expect([...d.after]).toEqual(['Y']);
});

test('a workstream waits for the open ones it builds on, started or not; a delivered one is no wait', () => {
  const ws = (id: string, state: Item['state'], buildsOn: string[] = []) => ({ ...card(id), state, parent: 'p', plan: { buildsOn } }) as Item;
  const all = [ws('W1', 'live'), ws('W2', 'planned', ['W1']), ws('W3', 'planned', ['W2', 'W1']), ws('W4', 'working')];
  const d = depsOf('W2', all)!;
  expect([...d.after]).toEqual(['W3']);
  expect(d.before.size).toBe(0);
  expect(d.edges).toEqual([['W2', 'W3']]);
  expect(depsOf('W1', all)).toBeUndefined();
});

test('a card snoozed until another card gets somewhere waits for that card', () => {
  const snoozed = { ...card('R'), hold: { reason: 'snoozed', since: '2026-11-01', on: { card: 'F', title: 'F', state: 'done' }, by: 'agent' } } as Item;
  const all = [card('F'), snoozed, card('S', 'R')];
  const d = depsOf('R', all)!;
  expect([...d.before]).toEqual(['F']);
  expect([...d.after]).toEqual(['S']);
  expect(depsOf('F', all)!.edges.sort()).toEqual([['F', 'R'], ['R', 'S']]);
  expect(depsOf('R', [snoozed])).toBeUndefined();
});

test('every direct wait on the project, of all kinds, not the chain; a finished card is waited for no longer', () => {
  const snoozed = { ...card('R'), hold: { reason: 'snoozed', since: '2026-11-01', on: { card: 'A', title: 'A', state: 'done' }, by: 'agent' } } as Item;
  const drawn = { ...card('M'), plan: { manualDependsOn: ['B'] } } as Item;
  const done = { ...card('F'), state: 'done' } as Item;
  const all = [...items, snoozed, drawn, done, card('G', 'F'), { ...card('H'), state: 'live', plan: { manualDependsOn: ['A'] } } as Item];
  expect(waitsAmong(all).sort()).toEqual([['A', 'B'], ['A', 'D'], ['A', 'R'], ['B', 'C'], ['B', 'D'], ['B', 'M']]);
});

test('the dot nearest the pointer shows, only within reach', () => {
  const cards = [
    { id: 'A', b: { x: 0, y: 0, w: 200, h: 100 } },
    { id: 'B', b: { x: 0, y: 130, w: 200, h: 100 } },
  ];
  expect(nearestHandle(cards, { x: 100, y: 108 }, 16)).toEqual({ id: 'A', side: 'bottom' });
  expect(nearestHandle(cards, { x: 100, y: 124 }, 16)).toEqual({ id: 'B', side: 'top' });
  expect(nearestHandle(cards, { x: 205, y: 50 }, 16)).toEqual({ id: 'A', side: 'right' });
  
  expect(nearestHandle(cards, { x: 100, y: 50 }, 16)).toBeNull();
  expect(nearestHandle(cards, { x: 20, y: 100 }, 16)).toBeNull();
});

test('with an edge reach, a dot also shows near any point of its edge, the nearest one winning', () => {
  const cards = [{ id: 'A', b: { x: 0, y: 0, w: 300, h: 100 } }];
  expect(nearestHandle(cards, { x: 30, y: -6 }, 18, 6)).toEqual({ id: 'A', side: 'top' });
  expect(nearestHandle(cards, { x: 30, y: -7 }, 18, 6)).toBeNull();
  expect(nearestHandle(cards, { x: 150, y: -18 }, 18, 6)).toEqual({ id: 'A', side: 'top' });
  expect(nearestHandle(cards, { x: 2, y: 3 }, 18, 6)).toEqual({ id: 'A', side: 'left' });
});

test("a finished card's dependencies stay as dim green lines, in a plan or not", () => {
  const ws = (id: string, state: Item['state'], extra: Partial<Item> = {}) => ({ ...card(id), kind: 'workstream', state, parent: 'P', ...extra }) as Item;
  const items = [
    ws('W1', 'live'),
    ws('W2', 'live', { plan: { buildsOn: ['W1'] } }),
    ws('W3', 'planned', { plan: { buildsOn: ['W2'] } }),
    ws('W4', 'planned', { plan: { manualDependsOn: ['W1', 'W3'] } }),
    { ...card('X'), state: 'done' } as Item,
    ws('W5', 'planned', { plan: { manualDependsOn: ['X'] } }),
  ];
  expect(settledAmong(items)).toEqual([
    { from: 'W1', to: 'W2' },
    { from: 'W2', to: 'W3' },
    { from: 'W1', to: 'W4' },
    { from: 'X', to: 'W5' },
  ]);
  
  expect(waitsAmong(items)).toEqual([['W3', 'W4']]);
});

test('a queued or snoozed card keeps its line from a finished card while it still records it', () => {
  const done = { ...card('F'), state: 'live' } as Item;
  const queued = card('Q', 'F');
  const snoozed = { ...card('S'), hold: { reason: 'snoozed', since: '2026-11-01', on: { card: 'F', title: 'F', state: 'done' }, by: 'agent' } } as Item;
  expect(settledAmong([done, queued, snoozed])).toEqual([
    { from: 'F', to: 'Q' },
    { from: 'F', to: 'S' },
  ]);
});

test('a parked card shows no wait while parked', () => {
  const mk = (id: string, extra: Partial<Item> = {}) => ({ id, state: 'planned', ...extra }) as Item;
  const a = mk('a', { hold: { reason: 'parkingLot', since: 'x' } });
  const b = mk('b', { plan: { manualDependsOn: ['a'] } as Item['plan'] });
  expect(waitsAmong([a, b])).toEqual([]);
  expect(waitsAmong([mk('a'), b])).toEqual([['a', 'b']]);
});
