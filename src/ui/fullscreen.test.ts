import { expect, test } from 'bun:test';
import { held } from './fullscreen';

test('a phone held upright is portrait, turned either way landscape', () => {
  expect(held(90, 0)).toBe('portrait');
  expect(held(-90, 0)).toBe('portrait');
  expect(held(0, -90)).toBe('landscape');
  expect(held(0, 90)).toBe('landscape');
  
  expect(held(60, -45)).toBe('portrait');
  expect(held(10, -60)).toBe('landscape');
});

test('between portrait and landscape the phone is diagonal, lying on the table flat', () => {
  expect(held(45, -60)).toBe('diagonal');
  expect(held(0, 0)).toBe('flat');
  expect(held(10, 15)).toBe('flat');
});

test('a device whose natural orientation is landscape reads the other way round', () => {
  expect(held(90, 0, false)).toBe('landscape');
  expect(held(0, -90, false)).toBe('portrait');
});

test('without the readings nothing is known', () => {
  expect(held(null, 0)).toBeNull();
  expect(held(90, null)).toBeNull();
});
