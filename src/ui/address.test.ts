import { expect, test } from 'bun:test';
import { knowProjects, projectNamed, projectPath, cardPath, feedbackLogPath, named, queryWithout, readAddress, upgradeAddress } from './address';

const at = (url: string) => new URL(url, 'http://obeya');

test('the path names the canvas and the card open on it', () => {
  expect(readAddress(at('/p/shop'))).toEqual({ canvas: 'shop' });
  expect(readAddress(at('/p/shop/'))).toEqual({ canvas: 'shop' });
  expect(readAddress(at('/p/shop/c/a1b2c3?view=phone&talk'))).toEqual({ canvas: 'shop', card: 'a1b2c3' });
  expect(readAddress(at('/p/my%20shop/c/a1b2c3'))).toEqual({ canvas: 'my shop', card: 'a1b2c3' });
  expect(readAddress(at('/'))).toEqual({});
  expect(readAddress(at('/p/shop/project/x'))).toEqual({});
});

test('the feedback log is a page of its own, opened from a canvas', () => {
  expect(feedbackLogPath('my shop')).toBe('/p/my%20shop/feedback');
  expect(readAddress(at('/p/my%20shop/feedback?group=month'))).toEqual({ canvas: 'my shop', page: 'feedback' });
  expect(readAddress(at('/p/shop/feedback/x'))).toEqual({});
});

test('an address from before paths still names what it named', () => {
  expect(readAddress(at('/?c=shop&card=1234'))).toEqual({ canvas: 'shop', card: '1234' });
  expect(readAddress(at('/?card=1234'))).toEqual({ card: '1234' });
});

test('a card’s address has its short code, else its id', () => {
  expect(projectPath('my shop')).toBe('/p/my%20shop');
  expect(cardPath('shop', { id: 'a1b2c3d4-0000', short: 'a1b2c3' })).toBe('/p/shop/c/a1b2c3');
  expect(cardPath('shop', { id: 'a1b2c3d4-0000' })).toBe('/p/shop/c/a1b2c3d4-0000');
  expect(cardPath('shop', 'a1b2c3d4-0000')).toBe('/p/shop/c/a1b2c3d4-0000');
});

test('a card is found by its short code or its whole id', () => {
  const items = [
    { id: 'a1b2c3d4-0000', short: 'a1b2c3' },
    { id: 'ffffff00-0000', short: 'ffffff' },
  ];
  expect(named(items, 'ffffff')).toBe(items[1]!);
  expect(named(items, 'FFFFFF')).toBe(items[1]!);
  expect(named(items, 'a1b2c3d4-0000')).toBe(items[0]!);
  expect(named(items, 'a1b2c')).toBeUndefined();
});

test('the query keeps what the path does not say, flags as bare names', () => {
  expect(queryWithout('?c=shop&card=1&view=phone&talk', 'c', 'card')).toBe('?view=phone&talk');
  expect(queryWithout('?c=shop', 'c')).toBe('');
});

test('existing path bookmarks still resolve, including the feedback page', () => {
  expect(readAddress(at('/c/my%20shop/card/ab12?view=phone&talk'))).toEqual({ canvas: 'my shop', card: 'ab12' });
  expect(readAddress(at('/c/shop'))).toEqual({ canvas: 'shop' });
  expect(readAddress(at('/c/shop/feedback'))).toEqual({ canvas: 'shop', page: 'feedback' });
});


test('upgrading bookmarks preserves phone flags, feedback filters, and fragments without a history step', () => {
  const saved = ['location', 'history'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  try {
    for (const [from, to] of [
      ['/c/my%20shop/card/ab12?view=phone&talk#reply', '/p/my%20shop/c/ab12?view=phone&talk#reply'],
      ['/c/shop/feedback?group=month#ratings', '/p/shop/feedback?group=month#ratings'],
      ['/?c=shop&card=ab12&view=phone&talk', '/p/shop/c/ab12?view=phone&talk'],
    ]) {
      let replaced = '';
      const state = { open: true };
      Object.defineProperty(globalThis, 'location', { configurable: true, value: at(from!) });
      Object.defineProperty(globalThis, 'history', { configurable: true, value: {
        state,
        replaceState: (kept: unknown, _: string, path: string) => { expect(kept).toBe(state); replaced = path; },
      } });
      upgradeAddress();
      expect(replaced).toBe(to!);
    }
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('a project is addressed by its name, its id where the name does not tell it apart', () => {
  const list = [
    { id: 'shop', name: 'Store' },
    { id: 'blog', name: 'My Blog' },
    { id: 'a', name: 'Twin' },
    { id: 'b', name: 'twin' },
    { id: 'store', name: 'Other' },
  ];
  knowProjects(list);
  expect(projectPath('blog')).toBe('/p/my-blog');
  expect(cardPath('blog', { id: 'a1b2c3d4', short: 'a1b2c3' })).toBe('/p/my-blog/c/a1b2c3');
  expect(feedbackLogPath('blog')).toBe('/p/my-blog/feedback');
  // another project's id is not taken over; equal names fall back to ids
  expect(projectPath('shop')).toBe('/p/shop');
  expect(projectPath('store')).toBe('/p/other');
  expect(projectPath('a')).toBe('/p/a');
  expect(projectPath('b')).toBe('/p/b');
  expect(projectNamed(list, 'my-blog')?.id).toBe('blog');
  expect(projectNamed(list, 'My Blog')?.id).toBe('blog');
  expect(projectNamed(list, 'store')?.id).toBe('store');
  expect(projectNamed(list, 'Store')?.id).toBe('store');
  expect(projectNamed(list, 'a')?.id).toBe('a');
  expect(projectNamed(list, 'gone')).toBeUndefined();
  knowProjects([{ id: 'shop', name: 'Store' }]);
  expect(projectPath('shop')).toBe('/p/store');
  expect(projectNamed([{ id: 'shop', name: 'Store' }], 'shop')?.id).toBe('shop');
  knowProjects([]);
});
