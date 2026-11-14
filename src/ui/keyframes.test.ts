import { expect, test } from 'bun:test';
import { Glob } from 'bun';

// Every animation the UI names in its classes (`animate-[name_…]`) has its keyframes in frost.css or tailwind.css:
// a missing one makes no error anywhere, the element just stands still (the working bar's `flow` went that way).

test('every animation named in a class has its keyframes', async () => {
  const dir = new URL('.', import.meta.url).pathname;
  const css = (await Bun.file(`${dir}frost.css`).text()) + (await Bun.file(`${dir}tailwind.css`).text());
  const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!));
  const missing: string[] = [];
  for await (const file of new Glob('**/*.{ts,tsx}').scan(dir)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const source = await Bun.file(`${dir}${file}`).text();
    for (const [, name] of source.matchAll(/animate-\[([a-z][a-z0-9-]*)_/g)) if (!defined.has(name!)) missing.push(`${file}: ${name}`);
  }
  expect(missing).toEqual([]);
});
