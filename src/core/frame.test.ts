import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAMES_POLICY, mockPage, pagePolicy, withHeightReport, withMarkReport } from './frame';

test('a page reports its height at the end of its body, or of the page without one', () => {
  expect(withHeightReport('<html><body><h2>Graph</h2></body></html>')).toMatch(/<h2>Graph<\/h2><script>[\s\S]*obeyaHeight[\s\S]*<\/script><\/body><\/html>$/);
  expect(withHeightReport('<h2>Graph</h2>')).toMatch(/^<h2>Graph<\/h2><script>[\s\S]*obeyaHeight/);
});

test('a page on the card says what the owner marks in it, and takes it away when told', () => {
  const page = withMarkReport('<html><body><p>Finding</p></body></html>');
  expect(page).toMatch(/<p>Finding<\/p><script>[\s\S]*obeyaMarked[\s\S]*obeyaUnmark[\s\S]*<\/script><\/body><\/html>$/);
  expect(withMarkReport('<p>Finding</p>')).toMatch(/^<p>Finding<\/p><script>[\s\S]*obeyaMarked/);
});

const SEALED = /^<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="([^"]*)"><meta http-equiv="x-dns-prefetch-control" content="off">/;

test('a mock of a few lines becomes a page of its own; a whole page stays as it is', () => {
  const few = mockPage('<button>Export</button>');
  expect(few).toMatch(new RegExp(SEALED.source + /<style>body\{[^}]*\}<\/style><\/head><body><button>Export<\/button><script>/.source));
  expect(few).toContain('obeyaHeight');
  expect(few).toContain('obeyaMarked');
  const whole = '<!doctype html><html lang="de"><body style="margin:0"><p>Ganz</p></body></html>';
  expect(mockPage(whole)).toMatch(new RegExp(SEALED.source + /<!doctype html><html lang="de"><body style="margin:0"><p>Ganz<\/p><script>[\s\S]*<\/script><\/body><\/html>$/.source));
  expect(mockPage(whole)).toContain('obeyaMarked');
});

test('a mock loads nothing from elsewhere, whatever comes before its own head', () => {
  const page = mockPage('<!-- <head> --><html><head><link rel="stylesheet" href="https://cdn.example/x.css"></head><body>x</body></html>');
  expect(SEALED.exec(page)?.[1]).toBe(pagePolicy());
  expect(pagePolicy()).not.toContain("'self'");
  expect(pagePolicy()).toMatch(/^default-src data: blob:;/);
  expect(pagePolicy('http://127.0.0.1:4417')).toMatch(/^default-src 'self' http:\/\/127\.0\.0\.1:4417 data: blob:;/);
  expect(pagePolicy()).toContain("form-action 'none'");
});

test("Seismic's page frames only its own addresses", () => {
  const index = readFileSync(join(import.meta.dir, '../ui/index.html'), 'utf8');
  expect(index).toContain(`<meta http-equiv="Content-Security-Policy" content="${FRAMES_POLICY}">`);
});
