import { expect, test } from 'bun:test';
import { issueFooter, issueUrl, MAX_ISSUE_URL, withoutFooter } from './wish';

test('the link opens a prefilled issue on Seismic’s repository', () => {
  const { url, trimmed } = issueUrl('Sort cards by date', 'I asked Seismic to sort the cards & it could not.', '…');
  expect(trimmed).toBe(false);
  const u = new URL(url);
  expect(`${u.origin}${u.pathname}`).toBe('https://github.com/sadilek/obeya/issues/new');
  expect(u.searchParams.get('title')).toBe('Sort cards by date');
  expect(u.searchParams.get('body')).toBe('I asked Seismic to sort the cards & it could not.');
});

test('a body too long for the link is cut, with the note at the cut, and never in half a character', () => {
  const body = '🦊 Füchse '.repeat(2000);
  const { url, trimmed } = issueUrl('Long', body, '(The rest did not fit.)');
  expect(trimmed).toBe(true);
  expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
  const out = new URL(url).searchParams.get('body')!;
  expect(out).toEndWith('\n\n(The rest did not fit.)');
  expect(body.startsWith(out.slice(0, -'\n\n(The rest did not fit.)'.length))).toBe(true);
  expect(out.length).toBeGreaterThan(500);
});

test('the footer line is the body’s last, and comes off for rewriting', () => {
  const footer = issueFooter('0.3.0', 'macOS', 'app');
  expect(footer).toBe('Seismic 0.3.0 · macOS · app');
  expect(withoutFooter(`Text.\n\nMore.\n\n${footer}`)).toBe('Text.\n\nMore.');
  expect(withoutFooter('No footer here.')).toBe('No footer here.');
});
