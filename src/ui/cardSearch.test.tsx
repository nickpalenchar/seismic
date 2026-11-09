import { expect, test } from 'bun:test';
import type { Item } from '../core/types';
import { finderResults } from './cardSearch';

const card = (id: string, title: string, more: Partial<Item> = {}) => ({ id, short: id, title, body: '', state: 'planned', ...more }) as Item;

test('the project finder omits a card hidden inside a merge proposal', () => {
  const titles = finderResults([card('hidden', 'Merged login card', { idea: { mergingInto: 'proposal' } }), card('visible', 'Login settings')], '').map((i) => i.title);
  expect(titles).toContain('Login settings');
  expect(titles).not.toContain('Merged login card');
});

test('the project finder offers cards beyond the link menu’s eight suggestions', () => {
  const items = Array.from({ length: 12 }, (_, n) => card(`card${n}`, `Matching card ${n}`));
  expect(finderResults(items, '')).toHaveLength(12);
});
