import { expect, test } from 'bun:test';
import { pagePolicy } from '../core/frame';
import { PAGE_STYLE } from './demo-page';

test('pages carry Inter as an inlined font-face, which the page policy allows', () => {
  expect(PAGE_STYLE).toMatch(/@font-face \{ font-family: Inter;[^}]*src: url\(data:font\/woff2;base64,d09GM/);
  expect(PAGE_STYLE).toContain('Copyright 2016 The Inter Project Authors');
  expect(PAGE_STYLE).toContain('SIL OPEN FONT LICENSE Version 1.1');
  expect(pagePolicy('file:')).toMatch(/default-src [^;]*data:/);
});
