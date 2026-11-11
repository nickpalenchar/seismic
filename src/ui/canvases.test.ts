import { expect, test } from 'bun:test';
import emojis from 'emojibase-data/en/data.json';
import { CANVAS_ICON_COLORS, CANVAS_LUCIDE_ICONS, isCanvasIcon } from '../core/canvas-icons';
import { type Canvas, canvasNamedBy, canvasOfHash, type Item } from '../core/types';
import { iconsMatching, nameProblem, stubsOf } from './canvases';
import { lucideOf } from './canvasIcon';

const canvases: Canvas[] = [
  { id: 'm', name: 'main' },
  { id: 'b', name: 'Billing', icon: '💶' },
  { id: 'g', name: 'Growth' },
];

test('a hash names a canvas by its name or place; an empty or unknown one names none, and the page then shows the first', () => {
  expect(canvasNamedBy(canvases, '#billing')?.id).toBe('b');
  expect(canvasNamedBy(canvases, '#2')?.id).toBe('b');
  expect(canvasNamedBy(canvases, '#Gr%6Fwth')?.id).toBe('g');
  expect(canvasNamedBy(canvases, '')).toBeUndefined();
  expect(canvasNamedBy(canvases, '#nope')).toBeUndefined();
  expect(canvasNamedBy(canvases, '#4')).toBeUndefined();
  expect(canvasOfHash(canvases, '#nope')?.id).toBe('m');
});

test('the dialog holds a name to the rule: not empty, not too long, no number from 1 to 999, not another canvas’s', () => {
  expect(nameProblem('  ', canvases)).toBeDefined();
  expect(nameProblem('x'.repeat(41), canvases)).toBeDefined();
  expect(nameProblem('42', canvases)).toBeDefined();
  expect(nameProblem('1000', canvases)).toBeUndefined();
  expect(nameProblem('billing', canvases)).toBeDefined();
  // its own name, in another case, is no clash
  expect(nameProblem('billing', canvases, 'b')).toBeUndefined();
  expect(nameProblem('Design', canvases)).toBeUndefined();
});

test('every icon the picker offers is one a canvas may carry, and each Lucide one draws, in each colour', () => {
  // the emoji picker offers Emojibase's emojis but the components (skin tones, hair styles), with their skin tones
  const offered = emojis.filter((e) => e.group !== undefined && e.group !== 2).flatMap((e) => [e.emoji, ...(e.skins ?? []).map((s) => s.emoji)]);
  expect(offered.length).toBeGreaterThan(3000);
  expect(offered.filter((e) => !isCanvasIcon(e))).toEqual([]);
  expect(CANVAS_LUCIDE_ICONS.filter((n) => !lucideOf(`lucide:${n}`))).toEqual([]);
  expect(lucideOf('lucide:rocket:blue')?.color).toBe(CANVAS_ICON_COLORS.blue);
  expect(lucideOf('lucide:rocket')?.color).toBeUndefined();
});

test('the icon search finds the Lucide icons whose name holds every word typed', () => {
  expect(iconsMatching('')).toHaveLength(CANVAS_LUCIDE_ICONS.length);
  expect(iconsMatching('chart')).toEqual(['chart-bar', 'chart-line', 'chart-pie']);
  expect(iconsMatching('Git pull')).toEqual(['git-pull-request']);
  expect(iconsMatching('no such')).toEqual([]);
});

test('a wait to a card on another canvas ends in a stub on the side of the card shown', () => {
  const card = (id: string, canvas: string, more: Partial<Item> = {}) => ({ id, canvas, title: id, ...more }) as Item;
  const items = [card('a', 'm'), card('b', 'm'), card('d', 'b'), card('x', 'b', { archivedAt: '2026-11-01' })];
  const byId = (id: string) => items.find((i) => i.id === id);
  const placed = new Set(['a', 'b']);
  const stubs = stubsOf(
    [
      ['d', 'a'],
      ['a', 'd'],
      ['a', 'b'],
      ['x', 'b'],
    ],
    placed,
    byId,
    (id) => id,
    canvases,
    'm',
  );
  expect(stubs.map((s) => [s.here, s.other.id, s.dir, s.canvas.name])).toEqual([
    ['a', 'd', 'before', 'Billing'],
    ['a', 'd', 'after', 'Billing'],
  ]);
});
