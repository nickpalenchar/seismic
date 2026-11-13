import { expect, test } from 'bun:test';
import tailwind from 'bun-plugin-tailwind';
import { Glob } from 'bun';

// Tailwind beside frost.css (tailwind.css): its utilities are generated for every word in src/ui that
// names one, so a class frost.css styles named like a utility (`hidden`, `fixed`, `ring`) would get the
// utility's styles too. And no control is bespoke: they are the parts in components/.

const dir = new URL('.', import.meta.url).pathname;
const read = (path: string) => Bun.file(`${dir}${path}`).text();
const oldSheets = ['frost.css', ...new Glob('components/*.css').scanSync(dir)];

const built = await Bun.build({ entrypoints: [`${dir}tailwind.css`], plugins: [tailwind] });
const generated = await built.outputs[0]!.text();

/** The class names a stylesheet's selectors use, unescaped (`.first\:rounded-l` is `first:rounded-l`, not `first`). */
const classes = (css: string) =>
  new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?(?:[A-Za-z_]|\\.)(?:[\w-]|\\.)*)/g)].map((m) => m[1]!.replace(/\\(.)/g, '$1')));

test('Tailwind builds, with its preflight in the base layer', () => {
  expect(built.success).toBe(true);
  expect(generated).toContain('@layer utilities');
  expect(generated).toMatch(/@layer base\s*\{/);
  expect(generated).toContain('box-sizing: border-box');
});

/**
 * The utilities a stylesheet's rules are for: per rule the longest class its selector names, as the
 * other classes there are those an arbitrary variant reaches (`[.ph-kb_.ph-view~&]:hidden`,
 * `[&_.f-dot]:hidden`, `resizing:` on `.resizing`), not utilities of their own.
 */
const subjects = (css: string) =>
  new Set(
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].flatMap((m) => {
      const own = [...classes(m[1]!)];
      return own.length ? [own.reduce((a, b) => (b.length > a.length ? b : a))] : [];
    }),
  );

test('no class the old stylesheets style is also a Tailwind utility', async () => {
  const utilities = subjects(generated.slice(generated.indexOf('@layer utilities')));
  const clashes: string[] = [];
  for (const sheet of oldSheets) for (const c of classes(await read(sheet))) if (utilities.has(c)) clashes.push(`${sheet}: .${c}`);
  expect(clashes).toEqual([]);
});

test('every frost token the shadcn tokens name is defined, in light and in dark', async () => {
  const own = await read('tailwind.css');
  const styles = await read('frost.css');
  const defined = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return new Set([...css.slice(at, css.indexOf('\n}', at)).matchAll(/--([\w-]+):/g)].map((m) => m[1]!));
  };
  const light = new Set([...defined(own, ':root'), ...defined(styles, ':root')]);
  const dark = defined(styles, ':root:where([data-theme="dark"], :not([data-theme])[data-system-theme="dark"])');
  const named = new Set([...own.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]!));
  // `--c` and `--hl` are set per element by the rules that use them; the faces are the same in both looks
  const perElement = new Set(['c', 'hl']);
  const faces = new Set(['font', 'mono']);
  const missing = [...named].filter((v) => !light.has(v) && !perElement.has(v));
  expect(missing).toEqual([]);
  // a colour the light look sets, the dark one sets too
  const themed = [...named].filter((v) => !defined(own, ':root').has(v) && !perElement.has(v) && !faces.has(v));
  expect(themed.filter((v) => !dark.has(v))).toEqual([]);
});

// Every menu, dialog, switch and select is a part of src/ui/components/ (shadcn on Radix), which brings its own
// role, keyboard and focus handling; a view that writes one itself leaves it out.
test('no bespoke control outside src/ui/components/', async () => {
  const bespoke = [/className="btn[ "]/, /className="btn-(?!mark)/, /role="switch"/, /<select/, /role="dialog"/, /role="menu"/, /useMenuClose/];
  // the few places a part cannot do it: each stays with its reason
  const allowed: Record<string, string> = {
    'phone.tsx': 'the project switcher is a native select laid invisibly over its button, so a finger gets the system picker; the phone\'s full-screen sheets are dialogs of their own',
    'fullPage.tsx': 'a full page is a dialog landmark over the project, not a modal part',
    'chats.tsx': 'the chats drawer is a docked panel that keeps the canvas usable',
    'desktopNotify.tsx': 'the ask of the desktop notification is a card in the corner',
  };
  const found: string[] = [];
  for (const file of new Glob('**/*.{ts,tsx}').scanSync(dir)) {
    if (file.startsWith('components/') || file.includes('.test.') || allowed[file]) continue;
    const text = await read(file);
    for (const needle of bespoke) if (needle.test(text)) found.push(`${file}: ${needle.source}`);
  }
  expect(found).toEqual([]);
});
