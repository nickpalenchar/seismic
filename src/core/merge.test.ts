import { expect, test } from 'bun:test';
import { activeMergeCard } from './merge';
import type { Item, Merge } from './types';

const card = (id: string, more: Partial<Item> = {}): Item => ({ id, kind: 'task', state: 'planned', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', ...more });

test('either original card reopens the current merge, while preparing, ready, or failed', () => {
  const original = card('a', { possibleDuplicates: ['b'] });
  const partner = card('b');
  for (const result of [{}, { title: 'Combined', task: 'Combined task' }, { failed: 'Try again' }]) {
    const merge: Merge = { with: partner.id, ...result };
    const owner = card('a', { idea: { proposal: { questions: [], merge } } });
    const hidden = card('b', { idea: { mergingInto: owner.id } });
    expect(activeMergeCard(original, [owner, hidden])).toBe(owner);
    expect(activeMergeCard(partner, [owner, hidden])).toBe(owner);
    expect(activeMergeCard(hidden, [owner, hidden])).toBe(owner);
  }
});

test('separated cards open individually, even when an old card still names its merge', () => {
  const oldPartner = card('b', { idea: { mergingInto: 'a' } });
  const a = card('a');
  const b = card('b');
  expect(activeMergeCard(oldPartner, [a, b])).toBe(b);
  expect(activeMergeCard(a, [a, b])).toBe(a);
});
