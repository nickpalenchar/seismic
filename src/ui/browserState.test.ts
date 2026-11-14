import { expect, test } from 'bun:test';
import { migrateBrowserState, renamedDraftKey, renamedKey } from './browserState';

/** A Storage that keeps its entries in a map. */
const storage = (init: Record<string, string> = {}): Storage => {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
};

test('names from before the rename move to the new ones, a value already there stays', () => {
  const s = storage({ 'obeya-theme': 'dark', 'obeya-phone-project': 'shop', 'obeya.talkFolded': '1', 'seismic-phone-project': 'blog', other: 'x' });
  expect(migrateBrowserState([s])).toBe(3);
  expect(s.getItem('seismic-theme')).toBe('dark');
  expect(s.getItem('seismic.talkFolded')).toBe('1');
  expect(s.getItem('seismic-phone-project')).toBe('blog');
  expect(s.getItem('obeya-theme')).toBeNull();
  expect(s.getItem('obeya-phone-project')).toBeNull();
  expect(s.getItem('other')).toBe('x');
  expect(migrateBrowserState([s])).toBe(0);
});

test('the draft keys of the sidebar are renamed, others stay', () => {
  expect(renamedDraftKey('obeya')).toBe('seismic');
  expect(renamedDraftKey('obeya:shop')).toBe('seismic:shop');
  expect(renamedDraftKey('card:c1')).toBe('card:c1');
  expect(renamedKey('obeyas')).toBeNull();
});
