import { expect, test } from 'bun:test';
import type { Canvas, Group, Item, RepoRef } from '../../core/types';
import { DEFAULT_KEPT, facetCounts, filterRows, keptOf, NO_FILTERS, sortRows, tableRows } from './rows';

const item = (id: string, p: Partial<Item> = {}): Item => ({ id, kind: 'task', state: 'planned', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r1', canvasVisible: true, ...p });
const canvases: Canvas[] = [{ id: 'c-main', name: 'main' }, { id: 'c-ui', name: 'ui' }];
const groups: Group[] = [{ id: 'g1', name: 'Login', hue: 10 }];
const repos: RepoRef[] = [{ id: 'r1', name: 'app', path: '/app', branch: 'main' }];
const rows = (items: Item[]) => tableRows(items, { canvases, groups, repos });
const ids = (rs: { item: Item }[]) => rs.map((r) => r.item.id);

test('rows are the cards on every canvas and the workstreams of plans, collapsed ones too; not parked, snoozed or archived ones', () => {
  const rs = rows([
    item('a'),
    item('b', { canvas: 'c-ui' }),
    item('plan', { kind: 'plan', source: 'plan', plan: { collapsed: true } as Item['plan'] }),
    item('w1', { parent: 'plan', source: 'plan' }),
    item('parked', { hold: { reason: 'parkingLot' } as Item['hold'], canvasVisible: false }),
    item('snoozed', { hold: { reason: 'snoozed', until: '2030-01-01T00:00:00Z', since: '2026-01-01T00:00:00Z' } as Item['hold'] }),
    item('archived', { archivedAt: '2026-01-01T00:00:00Z', canvasVisible: false }),
    item('orphan', { parent: 'gone' }),
  ]);
  expect(ids(rs)).toEqual(['a', 'b', 'plan', 'w1']);
  expect(rs[0]!.canvas).toBe('c-main');
  expect(rs[3]!.plan).toBe('plan');
});

test('a row carries the names the table shows: group, repository, labels', () => {
  const [r] = rows([item('a', { group: 'g1', labels: { priority: 'high', category: 'docs', complexity: 3 }, updatedAt: '2026-11-01T00:00:00Z' })]);
  expect(r).toMatchObject({ group: 'Login', repo: 'app', priority: 'high', category: 'docs', complexity: 3, updated: '2026-11-01T00:00:00Z' });
});

test('enumerations sort by their own order, empty values last in either direction', () => {
  const rs = rows([
    item('none'),
    item('crit', { labels: { priority: 'critical' } }),
    item('trivial', { labels: { priority: 'trivial' } }),
    item('medium', { labels: { priority: 'medium' } }),
  ]);
  expect(ids(sortRows(rs, { id: 'priority', desc: false }, canvases))).toEqual(['trivial', 'medium', 'crit', 'none']);
  expect(ids(sortRows(rs, { id: 'priority', desc: true }, canvases))).toEqual(['crit', 'medium', 'trivial', 'none']);
});

test('state sorts in lifecycle order, canvas in the owner’s order, not alphabetically', () => {
  const rs = rows([item('live', { state: 'live' }), item('idea', { state: 'idea' }), item('waiting', { state: 'waiting', canvas: 'c-ui' })]);
  expect(ids(sortRows(rs, { id: 'state', desc: false }, canvases))).toEqual(['idea', 'waiting', 'live']);
  expect(ids(sortRows(rs, { id: 'canvas', desc: true }, [...canvases].reverse()))).toEqual(['live', 'idea', 'waiting']);
});

test('the default is newest first; titles sort as text, numbers within them by value', () => {
  const rs = rows([item('Card 10', { updatedAt: '2026-11-03T00:00:00Z' }), item('card 9', { updatedAt: '2026-11-05T00:00:00Z' }), item('Undated')]);
  expect(ids(sortRows(rs, DEFAULT_KEPT.sort, canvases))).toEqual(['card 9', 'Card 10', 'Undated']);
  expect(ids(sortRows(rs, { id: 'title', desc: false }, canvases))).toEqual(['card 9', 'Card 10', 'Undated']);
});

test('filters combine; a facet counts what the other filters leave, priority with "None"', () => {
  const rs = rows([
    item('Fix login', { state: 'waiting', labels: { priority: 'critical' } }),
    item('Fix logout', { state: 'working', canvas: 'c-ui' }),
    item('Docs pass', { state: 'waiting' }),
  ]);
  expect(ids(filterRows(rs, { ...NO_FILTERS, title: ' fix ' }))).toEqual(['Fix login', 'Fix logout']);
  expect(ids(filterRows(rs, { ...NO_FILTERS, title: 'fix', state: ['waiting'] }))).toEqual(['Fix login']);
  expect(ids(filterRows(rs, { ...NO_FILTERS, priority: ['none'] }))).toEqual(['Fix logout', 'Docs pass']);
  expect(ids(filterRows(rs, { ...NO_FILTERS, canvas: ['c-ui'] }))).toEqual(['Fix logout']);
  const f = { ...NO_FILTERS, state: ['waiting' as const] };
  expect([...facetCounts(rs, f, 'state')]).toEqual([['waiting', 2], ['working', 1]]);
  expect([...facetCounts(rs, f, 'priority')]).toEqual([['critical', 1], ['none', 1]]);
});

test('what was kept is read back with anything invalid set to its default', () => {
  expect(keptOf(null)).toEqual(DEFAULT_KEPT);
  expect(keptOf({ sort: { id: 'nope', desc: false }, filters: { title: 3, state: ['waiting', 'x'], priority: ['none', 'huge'] }, hidden: ['group', 'nope'] })).toEqual({
    sort: DEFAULT_KEPT.sort,
    filters: { title: '', state: ['waiting'], priority: ['none'], canvas: [] },
    hidden: ['group'],
  });
});
