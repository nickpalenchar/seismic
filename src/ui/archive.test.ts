import { expect, test } from 'bun:test';
import type { Item } from '../core/types';
import { matches, searchWords } from './archive';

const card = (title: string, more: Partial<Item> = {}) => ({ id: title, kind: 'task', state: 'done', title, body: '', x: 0, y: 0, source: 'manual', ...more }) as Item;

test('a search finds a card holding every word, in any case and without accents', () => {
  const i = card('Über den Klon warten', { body: 'Nachfrage an fertige Karte' });
  expect(matches(i, searchWords('uber'))).toBe(true);
  expect(matches(i, searchWords('  KLON  karte '))).toBe(true);
  expect(matches(i, searchWords('klon demo'))).toBe(false);
});

test("a plan is found by its workstreams' titles", () => {
  const p = card('Voice', { kind: 'plan' });
  expect(matches(p, searchWords('whisper'), [card('Local Whisper model', { parent: 'Voice' })])).toBe(true);
  expect(matches(p, searchWords('whisper'))).toBe(false);
});

test('a search finds a card by the state and kind its entry shows', () => {
  expect(matches(card('Coupons', { state: 'live' }), searchWords('live'))).toBe(true);
  expect(matches(card('Voice', { kind: 'plan' }), searchWords('plan'))).toBe(true);
  expect(matches(card('Coupons'), searchWords('plan'))).toBe(false);
});
