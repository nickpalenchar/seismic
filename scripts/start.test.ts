import { expect, test } from 'bun:test';
import { isDevCheckout } from './start';

test('only a checkout named …-dev takes the home and the port of its own', () => {
  expect(isDevCheckout('/Users/nick/programming/obeya-dev')).toBe(true);
  expect(isDevCheckout('/Users/nick/programming/obeya-dev/')).toBe(true);
  expect(isDevCheckout('/Users/nick/programming/obeya')).toBe(false);
  expect(isDevCheckout('/Users/nick/dev/seismic')).toBe(false);
  expect(isDevCheckout('/Users/nick/programming/obeya-develop')).toBe(false);
});
