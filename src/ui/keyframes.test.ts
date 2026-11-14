import { expect, test } from 'bun:test';
import { Glob } from 'bun';

// Every animation the UI names in its classes (`animate-[name_…]`) has its keyframes in a stylesheet the page
// links (index.html), outside comments: a missing one makes no error anywhere, the element just stands still (the
// working bar's `flow` went that way).

const dir = new URL('.', import.meta.url).pathname;
const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The stylesheets index.html links, their comments taken out. */
async function linkedCss(): Promise<string> {
  const html = (await Bun.file(`${dir}index.html`).text()).replace(/<!--[\s\S]*?-->/g, '');
  const sheets = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map((m) => m[1]!);
  expect(sheets.length).toBeGreaterThan(0);
  return (await Promise.all(sheets.map((s) => Bun.file(`${dir}${s}`).text()))).map(uncommented).join('\n');
}

/** Each `@keyframes` of the CSS by name, with its body. */
function keyframes(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    for (; i < css.length && depth > 0; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    out.set(m[1]!, css.slice(m.index! + m[0].length, i - 1));
  }
  return out;
}

test('every animation named in a class has its keyframes', async () => {
  const defined = keyframes(await linkedCss());
  const missing: string[] = [];
  for await (const file of new Glob('**/*.{ts,tsx}').scan(dir)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const source = await Bun.file(`${dir}${file}`).text();
    for (const [, name] of source.matchAll(/animate-\[([a-z][a-z0-9-]*)_/g)) if (!defined.has(name!)) missing.push(`${file}: ${name}`);
  }
  expect(missing).toEqual([]);
});

test('a keyframe commented out counts as missing', () => {
  expect(keyframes(uncommented('/* @keyframes flow { to { opacity: 0; } } */')).has('flow')).toBe(false);
});

test('the working bar moves by transform alone, which repaints nothing', async () => {
  const flow = keyframes(await linkedCss()).get('flow')!;
  const properties = [...flow.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]!);
  expect(properties.length).toBeGreaterThan(0);
  for (const p of properties) expect(['transform', 'opacity']).toContain(p);
});
