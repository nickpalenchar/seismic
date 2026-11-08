import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../../core/types';
import { CardFace, type CardFaceProps } from './face';
import { cardKind } from './summary';

const card = (more: Partial<Item> = {}): Item => ({ id: 'c', kind: 'task', state: 'planned', title: 'Cart model', body: 'One cart per customer.', x: 0, y: 0, source: 'manual', repo: 'shop', ...more });
const face = (p: CardFaceProps) => renderToStaticMarkup(createElement(CardFace, p)).replace(/<!-- -->/g, '');
const labelled: Partial<Item> = { labels: { priority: 'high', category: 'frontend', subcategory: 'newFeature', complexity: 3, suggested: ['category'] } };
const asking = card({ ...labelled, state: 'waiting', need: 'question', question: { text: 'Serif or sans?', options: ['Serif', 'Sans'] } } as unknown as Partial<Item>);

test('a delivered workstream keeps its label before its title as a chip', () => {
  const ws = card({ state: 'live', parent: 'p', source: 'plan', plan: { label: 'W1' } });
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
  // once read, it shows the pin again
  const read = face({ item: asking, size: 's', unread: false });
  expect(read).not.toContain('unread-dot');
  expect(read).toContain('f-pin asking');
});

test('XS keeps to two lines: the priority flag, title and pin, then the short state, kind, tail and as much of the meta line as fits', () => {
  const html = face({ item: { ...asking, kind: 'plan' }, size: 'xs', tail: 'Waits for “Export”.' });
  expect(html).not.toContain('lchip');
  expect(html).toMatch(/^<span class="face face-xs"[^>]*><span class="f-ttl"><span class="prio prio-high bare" title="High">/);
  expect(html).not.toContain('>High<');
  expect(html).toContain('<span class="f-pin asking" title="Needs you">?</span></span>');
  expect(html).toContain('<span class="f-state">Question</span> · Plan · Waits for “Export”. · Serif or sans?</span>');
  // the plan's sheet shows a workstream's text below in full, without it in the line
  expect(face({ item: asking, size: 'xs', text: false })).toContain('<span class="f-state">Question</span></span>');
  // a workstream names itself by its label before the title; an idea does not say "Idea" twice
  const ws = face({ item: card({ parent: 'p', plan: { label: 'W2' } }), size: 'xs' });
  expect(ws).toContain('<span class="ws-no">W2</span>');
  expect(ws).not.toContain('Workstream');
  expect(face({ item: card({ state: 'idea', body: '', idea: { discussion: { status: 'open', brief: '', questions: [] } } } as unknown as Partial<Item>), size: 'xs' })).toContain('<span class="f-state">Idea</span></span>');
});

test("the smallest face says a card's state in a word or two, from one table", () => {
  const xs = (more: Partial<Item>) => face({ item: card({ body: '', ...more }), size: 'xs' }).match(/<span class="f-state">([^<]*)</)?.[1];
  expect(xs({ state: 'working' })).toBe('Working');
  expect(xs({ state: 'waiting', need: 'demo' })).toBe('Demo ready');
  expect(xs({ state: 'waiting', need: 'question', question: { text: 'Which?', options: [] } } as Partial<Item>)).toBe('Question');
  expect(xs({ queue: { behind: ['x'], reason: 'r', since: 'now' } } as Partial<Item>)).toBe('Queued');
  expect(xs({ state: 'planned' })).toBe('Planned');
  // M and S keep the state's own words
  expect(face({ item: card({ state: 'working' }) })).toContain('Agent at work');
});

test("a card's kind word, the same on its face, its open card and the archive", () => {
  expect(cardKind(card())).toBe('');
  expect(cardKind(card({ parent: 'p' }))).toBe('Workstream');
  expect(cardKind(card({ kind: 'plan' }))).toBe('Plan');
  expect(cardKind(card({ kind: 'question' }))).toBe('Question');
  expect(cardKind(card({ idea: { prototypeOf: 'i' } }))).toBe('Prototype');
  expect(cardKind(card({ review: { contribution: { number: 7, author: 'ann' } } } as Partial<Item>))).toBe('PR #7 · ann');
});

test('subtle: the pin is a small dot in the corner, the state line is plain, and a size without a pin shows no dot', () => {
  const s = face({ item: asking, size: 's', subtle: true });
  expect(s).toContain('class="face face-s subtle"');
  expect(s).toContain('class="pin-dot asking"');
  expect(s).not.toContain('f-pin');
  expect(face({ item: asking, size: 's', subtle: true, unread: true })).toContain('class="unread-dot"');
  expect(face({ item: asking, size: 'xs', subtle: true })).toContain('pin-dot');
  const m = face({ item: asking, subtle: true });
  expect(m).toContain('state subtle');
  expect(m).toContain('pin-dot');
  expect(m).not.toContain('badge');
  expect(face({ item: card({ state: 'working' }), subtle: true })).not.toContain('pin-dot');
});
