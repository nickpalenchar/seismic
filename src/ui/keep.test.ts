import { expect, test } from 'bun:test';
import { keep, type Kept, leaveSheet, settleUntil, takeKept, takeSheetLeft } from './keep';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const kept = (at: number): Kept => ({ at, card: 'c1', sheet: 'koordinator', scroll: [['["panel"]', 400]], drafts: [], video: { time: 23.5, playing: false } });

test('what a reload kept comes back once, on its project', () => {
  const s = store();
  keep(s, 'seismic', kept(1000));
  expect(takeKept(s, 'shop', 2000)).toBeNull();
  expect(takeKept(s, 'seismic', 2000)).toEqual(kept(1000));
  expect(takeKept(s, 'seismic', 2000)).toBeNull();
});

test('a page loaded long after starts afresh', () => {
  const s = store();
  keep(s, 'seismic', kept(1000));
  expect(takeKept(s, 'seismic', 1000 + 10 * 60_000)).toBeNull();
});

test("Seismic's sheet left open over a draft opens again on its project, closed or empty it stays closed", () => {
  const s = store();
  leaveSheet(s, 'seismic', true);
  expect(takeSheetLeft(s, 'shop')).toBe(false);
  expect(takeSheetLeft(s, 'seismic')).toBe(true);
  expect(takeSheetLeft(s, 'seismic')).toBe(false);
  leaveSheet(s, 'seismic', true);
  leaveSheet(s, 'seismic', false);
  expect(takeSheetLeft(s, 'seismic')).toBe(false);
});

test('a box whose content is still too short is put back for longer, but not for ever', () => {
  expect(settleUntil(0, 2500, 100, false)).toBe(2500);
  expect(settleUntil(0, 2500, 4000, true)).toBe(6500);
  expect(settleUntil(0, 6500, 19_000, true)).toBe(20_000);
  expect(settleUntil(0, 6500, 5000, false)).toBe(6500);
});
