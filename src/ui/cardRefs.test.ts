import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../core/types';
import { setCanvas } from './api';
import { smartLink } from './cardLink';
import { cardHref, cardSearchAt, lines, linkText, matchingCards, type NodeLike, textOf } from './cardRefs';
import { CardRefs, Inline } from './markdown';
import { Cards } from './message';

const card = (id: string, title: string, more: Partial<Item> = {}) => ({ id, short: id.slice(0, 4), title, state: 'planned', ...more }) as Item;

test('a slash at the start of the text or of a word searches cards, with the words after it on its line', () => {
  expect(cardSearchAt('/', 1)).toEqual({ start: 0, query: '' });
  expect(cardSearchAt('builds on /login bu', 19)).toEqual({ start: 10, query: 'login bu' });
  expect(cardSearchAt('first line\n/dem', 15)).toEqual({ start: 11, query: 'dem' });
});

test('a path, a slash inside a word, a slash before a space or on an earlier line searches nothing', () => {
  expect(cardSearchAt('see /src/ui', 11)).toBeNull();
  expect(cardSearchAt('and/or', 6)).toBeNull();
  expect(cardSearchAt('this / that', 11)).toBeNull();
  expect(cardSearchAt('/login\nnext', 11)).toBeNull();
  // a link put in before is no search
  expect(cardSearchAt('[Login](/p/x/c/ab12) ', 24)).toBeNull();
});

test('every word of the search is in the title or is the short code; titles that start with it first', () => {
  const items = [card('aaaa1', 'Fix the login page'), card('bbbb2', 'Login with Google'), card('cccc3', 'Dark mode'), card('dddd4', 'Old login', { archivedAt: '2026-01-01' })];
  expect(matchingCards(items, 'login').map((i) => i.id)).toEqual(['bbbb2', 'aaaa1']);
  expect(matchingCards(items, 'LOGIN page').map((i) => i.id)).toEqual(['aaaa1']);
  expect(matchingCards(items, 'cccc').map((i) => i.id)).toEqual(['cccc3']);
  // not the card itself, nor what is archived
  expect(matchingCards(items, 'login', 'bbbb2').map((i) => i.id)).toEqual(['aaaa1']);
  expect(matchingCards(items, 'nothing')).toEqual([]);
});

test('the link menu keeps eight suggestions while the canvas finder can request all matches', () => {
  const items = Array.from({ length: 12 }, (_, n) => card(`card${n}`, `Matching card ${n}`));
  expect(matchingCards(items, 'matching')).toHaveLength(8);
  expect(matchingCards(items, 'matching', undefined, Infinity)).toHaveLength(12);
});

test('a card\'s title as the text of its link, without brackets', () => {
  expect(linkText('Fix [the]  login')).toBe('Fix the login');
});

test('an address of a card names its canvas and code; another address none', () => {
  expect(cardHref('/p/my%20canvas/c/ab12')).toEqual({ canvas: 'my canvas', code: 'ab12' });
  expect(cardHref('https://x.org/p/a/c/b')).toBeNull();
});

test('the field shows the text line by line, a link to a card as a pill and other markdown as written', () => {
  expect(lines('See [Login](/p/o/c/ab12) and [docs](https://x.org).\n\n**end**')).toEqual([
    ['See ', { href: '/p/o/c/ab12', text: 'Login' }, ' and [docs](https://x.org).'],
    [],
    ['**end**'],
  ]);
});

// a DOM as the browser leaves it in the field, built of plain objects
const text = (v: string): NodeLike => ({ nodeType: 3, nodeName: '#text', nodeValue: v, childNodes: [] });
const el = (name: string, kids: NodeLike[] = [], attrs: Record<string, string> = {}): NodeLike => ({ nodeType: 1, nodeName: name, nodeValue: null, childNodes: kids, getAttribute: (n) => attrs[n] ?? null });
const pill = el('SPAN', [el('SPAN'), el('SPAN', [text('Login with Google')])], { 'data-href': '/p/o/c/ab12', 'data-text': 'Login' });

test('the field\'s content reads back as the text: a pill as its link, a line per block, a placeholder line break as none', () => {
  // as the field is filled: a block per line, an empty one holding a line break
  expect(textOf(el('DIV', [el('DIV', [text('See '), pill, text('\u00a0now')]), el('DIV', [el('BR')]), el('DIV', [text('end')])]))).toBe('See [Login](/p/o/c/ab12) now\n\nend');
  expect(textOf(el('DIV', [el('DIV', [text('a')]), el('DIV', [el('BR')])]))).toBe('a\n');
  expect(textOf(el('DIV', [el('DIV', [el('BR')])]))).toBe('');
  // as the browser types: the first line bare, the next ones in blocks, Shift+Enter a line break
  expect(textOf(el('DIV', [text('a'), el('DIV', [text('b')])]))).toBe('a\nb');
  expect(textOf(el('DIV', [text('a'), el('BR'), text('b'), el('BR'), el('BR')]))).toBe('a\nb\n');
  expect(textOf(el('DIV', [el('BR')]))).toBe('');
});

test('what the field shows reads back as the text it was filled with', () => {
  for (const md of ['', 'one line', 'a\n\nb', 'end with\n', 'See [Login](/p/o/c/ab12) and **this**'])
    expect(textOf(el('DIV', lines(md).map((ps) => el('DIV', ps.length ? ps.map((p) => (typeof p === 'string' ? text(p) : el('SPAN', [], { 'data-href': p.href, 'data-text': p.text }))) : [el('BR')]))))).toBe(md);
});

test('in a shown text a link to a card is a smart link: its state, current title and priority; one not on the canvas keeps its text, muted', () => {
  setCanvas('o');
  const items = [card('ab12xx', 'Login with Google', { state: 'working', priority: 'high' })];
  const md = 'Builds on [Login](/p/o/c/ab12) and [Gone](/p/o/c/zz99).';
  const html = renderToStaticMarkup(
    createElement(Cards.Provider, { value: { items, open: () => {} } }, createElement(CardRefs.Provider, { value: smartLink }, createElement(Inline, { md }))),
  );
  expect(html).toContain('<a class="smart-link s-working" href="/p/o/c/ab12"');
  expect(html).toContain('<span class="sl-title">Login with Google</span>');
  expect(html).toContain('prio prio-high');
  expect(html).toContain('<span class="smart-link gone"><span class="sl-dot"></span><span class="sl-title">Gone</span></span>');
  // without smart links (a plan doc, say) the link is its text, as before
  expect(renderToStaticMarkup(createElement(Inline, { md }))).toBe('Builds on <span>Login</span> and <span>Gone</span>.');
});

test('links saved in earlier card conversations remain smart links', () => {
  expect(cardHref('/c/my%20shop/card/ab12')).toEqual({ canvas: 'my shop', code: 'ab12' });
});
