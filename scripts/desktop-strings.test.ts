import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DESKTOP_STRINGS, desktopStrings } from './desktop-strings';

test('desktop/ui/strings.js is current with src/ui/strings.ts (else: bun scripts/desktop-strings.ts)', () => {
  expect(readFileSync(DESKTOP_STRINGS, 'utf8')).toBe(desktopStrings());
});

test('the bundled pages fill templates in, also with braces in the values', () => {
  const page = { SEISMIC_STRINGS: undefined as unknown, fillString: undefined as unknown };
  new Function('window', desktopStrings())(page);
  const strings = page.SEISMIC_STRINGS as { status: { unresponsive: string; unreachable: string } };
  const fill = page.fillString as (template: string, ...values: string[]) => string;
  expect(fill(strings.status.unresponsive, 'Studio {0}')).toBe('Studio {0} is unresponsive');
  expect(fill(strings.status.unreachable, 'https://studio:4417')).toStartWith('Nothing answers at https://studio:4417.');
});
