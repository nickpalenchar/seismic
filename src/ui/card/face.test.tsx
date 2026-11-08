import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../../core/types';
import { CardFace, type CardFaceProps } from './face';
import { cardKind } from './summary';

const card = (more: Partial<Item> = {}): Item => ({ id: 'c', kind: 'task', state: 'planned', title: 'Cart model', body: 'One cart per customer.', x: 0, y: 0, source: 'manual', repo: 'shop', ...more });
const face = (p: CardFaceProps) => renderToStaticMarkup(createElement(CardFace, p)).replace(/<!-- -->/g, '');
const labelled: Partial<Item> = { priority: 'high', category: 'frontend', subcategory: 'newFeature', complexity: 3, suggested: ['category'] };
const asking = card({ ...labelled, state: 'waiting', need: 'question', question: { text: 'Serif or sans?', options: ['Serif', 'Sans'] } } as unknown as Partial<Item>);

test('a delivered workstream keeps its label before its title as a chip', () => {
  const ws = card({ state: 'live', parent: 'p', source: 'plan', label: 'W1' });
  expect(face({ item: ws, chip: true })).toContain('<div class="ttl"><span class="ws-no">W1</span>Cart model</div>');
  // at a task's size the kind line says it
  expect(face({ item: ws })).toContain('<div class="ttl">Cart model</div>');
  expect(face({ item: ws })).toContain('<span>W1</span>');
});

test('M shows the label chips before where and kind, then title, meta line, state line and pin', () => {
  const html = face({ item: { ...asking, idea: undefined }, where: 'shop' });
  expect(html).toMatch(/<div class="kind"><span class="prio prio-high">.*High<\/span><span class="lchip lchip-category sugg".*<span class="lchip lchip-complexity".*<span>shop<\/span><\/div><div class="ttl">Cart model<\/div><div class="meta">Serif or sans\?<\/div><div class="state">.*Question for you.*<div class="badge pulse">\?<\/div>$/s);
});

test('S shows chips, where, kind and since on top, the pin or the unread dot, the state, then the text in place of the meta line', () => {
  const html = face({ item: asking, size: 's', where: 'Shop', since: '14:02' });
  expect(html).toContain('lchip-subcategory');
  expect(html).toContain('<span class="f-where">Shop · 14:02</span>');
  expect(html).toContain('<span class="f-pin asking" title="Needs you">?</span>');
  expect(html).toContain('<div class="f-text">Serif or sans?</div>');
  // an inbox entry: its unread dot in the pin's place, what it waits for in the meta line's
  const entry = face({ item: asking, size: 's', unread: true, text: 'Pick one' });
  expect(entry).toContain('class="unread-dot"');
  expect(entry).not.toContain('f-pin');
  expect(entry).toContain('<div class="f-text">Pick one</div>');
  expect(face({ item: asking, size: 's', unread: false })).not.toContain('unread-dot');
});

test('XS keeps to two lines: title and pin, then only the priority flag, the state, the kind and the tail', () => {
  const html = face({ item: { ...asking, kind: 'plan' }, size: 'xs', tail: 'Waits for “Export”.' });
  expect(html).not.toContain('lchip');
  expect(html).toContain('class="prio prio-high bare" title="High"');
  expect(html).not.toContain('>High<');
  expect(html).toContain('<span class="f-state">Question for you</span> · Plan · Waits for “Export”.');
  expect(html).toContain('<span class="f-pin asking" title="Needs you">?</span>');
  expect(html).not.toContain('Serif or sans');
  // a workstream names itself by its label before the title; an idea does not say "Idea" twice
  const ws = face({ item: card({ parent: 'p', label: 'W2' }), size: 'xs' });
  expect(ws).toContain('<span class="ws-no">W2</span>');
  expect(ws).not.toContain('Workstream');
  expect(face({ item: card({ state: 'idea', idea: { status: 'open', brief: '', questions: [] } } as unknown as Partial<Item>), size: 'xs' })).toContain('<span class="f-state">Idea</span></span>');
});

test("a card's kind word, the same on its face, its open card and the archive", () => {
  expect(cardKind(card())).toBe('');
  expect(cardKind(card({ parent: 'p' }))).toBe('Workstream');
  expect(cardKind(card({ kind: 'plan' }))).toBe('Plan');
  expect(cardKind(card({ kind: 'question' }))).toBe('Question');
  expect(cardKind(card({ prototypeOf: 'i' }))).toBe('Prototype');
  expect(cardKind(card({ contribution: { number: 7, author: 'ann' } } as Partial<Item>))).toBe('PR #7 · ann');
});
