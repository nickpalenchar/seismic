import { expect, test } from 'bun:test';
import { type Item } from '../core/types';
import { plannedOrder } from './phoneOrder';

const card = (id: string, createdAt?: string, hold?: Item['hold']): Item => ({ id, createdAt, hold, kind: 'task', state: 'planned', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', canvasVisible: true });
const snoozed: Item['hold'] = { reason: 'snoozed', by: 'owner', since: '2026-11-13T00:00:00Z', until: '2026-11-14T00:00:00Z', start: true };

test('recent snoozed plans cannot displace active plans from the first page', () => {
  const active = Array.from({ length: 20 }, (_, n) => card(`active-${n}`, new Date(Date.UTC(2026, 10, n + 1)).toISOString()));
  const newest = card('snoozed-new', '2026-12-02T00:00:00Z', snoozed);
  const older = card('snoozed-old', '2026-12-01T00:00:00Z', { ...snoozed, by: 'agent', until: undefined, on: { card: 'other', title: 'Other work', state: 'done' } });
  const sorted = [older, ...active, newest].sort(plannedOrder);
  expect(sorted.slice(0, 20).map((i) => i.id)).toEqual(active.toReversed().map((i) => i.id));
  expect(sorted.slice(20).map((i) => i.id)).toEqual(['snoozed-new', 'snoozed-old']);
  // Waking a planned card puts it back among active plans at its creation date.
  newest.hold = undefined;
  expect(sorted.sort(plannedOrder)[0]!.id).toBe('snoozed-new');
});

test('plans without dates follow dated peers, and ties preserve incoming order', () => {
  const items = [card('undated'), card('a', '2026-11-13T00:00:00Z'), card('b', '2026-11-13T00:00:00Z'), card('snoozed-undated', undefined, snoozed)];
  expect(items.sort(plannedOrder).map((i) => i.id)).toEqual(['a', 'b', 'undated', 'snoozed-undated']);
});
