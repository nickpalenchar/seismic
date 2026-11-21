import { expect, test } from 'bun:test';
import { holdLeaving, leave, leavesPage } from './leaving';

test('a step leaves the page when it goes to another project or page, or closes a page the query names', () => {
  expect(leavesPage('/p/shop', '/p/shop/c/a1b2')).toBe(false);
  expect(leavesPage('/p/shop/c/a1b2?view=table#c2', '/p/shop')).toBe(false);
  expect(leavesPage('/p/shop', '/p/store')).toBe(true);
  expect(leavesPage('/p/shop', '/p/shop/feedback')).toBe(true);
  expect(leavesPage('http://x/p/shop?settings', '/p/shop')).toBe(true);
  expect(leavesPage('/p/shop?settings', '/p/shop?needs')).toBe(true);
  expect(leavesPage('/p/shop', '/p/shop?settings')).toBe(false);
  expect(leavesPage('/p/shop?settings&view=table', '/p/shop?settings')).toBe(false);
});

test('a held leaving goes on once the owner discards, not before', () => {
  const gone: string[] = [];
  let proceed: (() => void) | null = null;
  const release = holdLeaving((p) => ((proceed = p), true));
  leave(() => gone.push('a'));
  expect(gone).toEqual([]);
  release();
  proceed!();
  leave(() => gone.push('b'));
  expect(gone).toEqual(['a', 'b']);
});
