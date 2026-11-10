import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

const html = await Bun.file(new URL('./index.html', import.meta.url)).text();
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;

for (const chosen of [null, 'light', 'dark', 'invalid', 'blocked']) {
  for (const dark of [false, true]) {
    test(`theme before first paint: ${chosen}, system ${dark ? 'dark' : 'light'}`, () => {
      const dataset: Record<string, string> = {};
      let changed = () => {};
      const media = {
        matches: dark,
        addEventListener(event: string, fn: () => void) {
          expect(event).toBe('change');
          changed = fn;
        },
      };
      runInNewContext(script, {
        document: { documentElement: { dataset } },
        localStorage: { getItem() { if (chosen === 'blocked') throw new Error('blocked'); return chosen; } },
        matchMedia(query: string) {
          expect(query).toBe('(prefers-color-scheme: dark)');
          return media;
        },
      });
      const explicit = chosen === 'light' || chosen === 'dark' ? chosen : undefined;
      expect(dataset.theme).toBe(explicit);
      expect(dataset.systemTheme).toBe(dark ? 'dark' : 'light');
      // A system change never replaces an explicit choice. Returning to System uses its latest value.
      media.matches = !dark;
      changed();
      expect(dataset.theme).toBe(explicit);
      expect(dataset.systemTheme).toBe(dark ? 'light' : 'dark');
      delete dataset.theme;
      expect(dataset.systemTheme).toBe(dark ? 'light' : 'dark');
    });
  }
}
