import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../core/types';
import { CardSearch } from './cardSearch';

test('the project finder omits a card hidden inside a merge proposal', () => {
  const card = (id: string, title: string, more: Partial<Item> = {}) => ({ id, short: id, title, body: '', state: 'planned', ...more }) as Item;
  const html = renderToStaticMarkup(createElement(CardSearch, {
    items: [card('hidden', 'Merged login card', { idea: { mergingInto: 'proposal' } }), card('visible', 'Login settings')],
    onOpen: () => {}, onClose: () => {},
  }));
  expect(html).toContain('Login settings');
  expect(html).not.toContain('Merged login card');
});

test('the project finder offers cards beyond the link menu’s eight suggestions', () => {
  const items = Array.from({ length: 12 }, (_, n) => ({ id: `card${n}`, short: `${n}`, title: `Matching card ${n}`, body: '', state: 'planned' }) as Item);
  const html = renderToStaticMarkup(createElement(CardSearch, { items, onOpen: () => {}, onClose: () => {} }));
  expect(html).toContain('Matching card 11');
  expect((html.match(/role="option"/g) ?? [])).toHaveLength(12);
});
