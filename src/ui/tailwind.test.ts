import { expect, test } from 'bun:test';
import tailwind from 'bun-plugin-tailwind';
import { Glob } from 'bun';

// Tailwind beside the old stylesheets (tailwind.css): its utilities are generated for every word in
// src/ui that names one, so a class of the old CSS named like a utility (`hidden`, `fixed`, `ring`)
// would get the utility's styles too, wherever the old rule leaves that property alone.

const dir = new URL('.', import.meta.url).pathname;
const read = (path: string) => Bun.file(`${dir}${path}`).text();
const oldSheets = ['styles.css', ...new Glob('components/*.css').scanSync(dir)];

const built = await Bun.build({ entrypoints: [`${dir}tailwind.css`], plugins: [tailwind] });
const generated = await built.outputs[0]!.text();

/** The class names a stylesheet's selectors use, unescaped (`.first\:rounded-l` is `first:rounded-l`, not `first`). */
const classes = (css: string) =>
  new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?(?:[A-Za-z_]|\\.)(?:[\w-]|\\.)*)/g)].map((m) => m[1]!.replace(/\\(.)/g, '$1')));

test('Tailwind builds, without its preflight', () => {
  expect(built.success).toBe(true);
  expect(generated).toContain('@layer utilities');
  expect(generated).not.toMatch(/@layer base\s*\{/);
});

test('no class the old stylesheets style is also a Tailwind utility', async () => {
  const utilities = classes(generated.slice(generated.indexOf('@layer utilities')));
  const clashes: string[] = [];
  for (const sheet of oldSheets) for (const c of classes(await read(sheet))) if (utilities.has(c)) clashes.push(`${sheet}: .${c}`);
  expect(clashes).toEqual([]);
});

test('every frost token the shadcn tokens name is defined, in light and in dark', async () => {
  const own = await read('tailwind.css');
  const styles = await read('styles.css');
  const defined = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return new Set([...css.slice(at, css.indexOf('\n}', at)).matchAll(/--([\w-]+):/g)].map((m) => m[1]!));
  };
  const light = new Set([...defined(own, ':root'), ...defined(styles, ':root')]);
  const dark = defined(styles, ':root:where([data-theme="dark"], :not([data-theme])[data-system-theme="dark"])');
  const named = new Set([...own.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]!));
  const missing = [...named].filter((v) => !light.has(v));
  expect(missing).toEqual([]);
  // a colour the light look sets, the dark one sets too
  const themed = [...named].filter((v) => !defined(own, ':root').has(v));
  expect(themed.filter((v) => !dark.has(v))).toEqual([]);
});
