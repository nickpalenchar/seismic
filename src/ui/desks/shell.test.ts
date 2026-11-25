import { expect, test } from 'bun:test';
import { deskError, fromPairingLink, originOf } from './shell';

test('a pairing link gives its origin and code; anything else gives nothing', () => {
  expect(fromPairingLink(' https://studio.tail1234.ts.net/pair?code=482913 ')).toEqual({ address: 'https://studio.tail1234.ts.net', code: '482913' });
  expect(fromPairingLink('http://10.0.0.5:4417/pair?code=000123')).toEqual({ address: 'http://10.0.0.5:4417', code: '000123' });
  expect(fromPairingLink('https://studio.tail1234.ts.net/pair?code=4829')).toBeNull();
  expect(fromPairingLink('https://studio.tail1234.ts.net/?code=482913')).toBeNull();
  expect(fromPairingLink('ftp://studio.tail1234.ts.net/pair?code=482913')).toBeNull();
  expect(fromPairingLink('seismic://studio.tail1234.ts.net/pair?code=482913')).toBeNull();
  expect(fromPairingLink('studio.tail1234.ts.net')).toBeNull();
});

test('an address without a scheme is taken as https, and only http and https are addresses', () => {
  expect(originOf('studio.tail1234.ts.net')).toBe('https://studio.tail1234.ts.net');
  expect(originOf('http://studio:4417/p/lab')).toBe('http://studio:4417');
  expect(originOf('  ')).toBeNull();
  expect(originOf('ftp://studio')).toBeNull();
  expect(originOf('https://')).toBeNull();
});

test("the shell's codes become words, naming the address where it matters", () => {
  expect(deskError('wrongCode')).toContain('code is wrong');
  expect(deskError('unreachable', 'https://studio')).toContain('https://studio does not answer');
  expect(deskError(new Error('notSeismic'), 'https://studio')).toContain('https://studio is not Seismic');
  expect(deskError('somethingNew')).toContain('(somethingNew)');
  
  expect(deskError('other')).toContain('(other)');
});
