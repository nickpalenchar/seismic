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

test('every token the token file names is defined, in light and in dark', async () => {
  const own = await read('tailwind.css');
  const defined = (selector: string) => {
    const at = own.indexOf(`${selector} {`);
    return new Set([...own.slice(at, own.indexOf('\n}', at)).matchAll(/--([\w-]+):/g)].map((m) => m[1]!));
  };
  const light = defined(':root');
  const named = new Set([...own.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]!));
  // Tailwind's own variables, and the ones a rule sets per element: the state colour (`--c` and its steps, set by
  // `.s-*` and `c-*`), a link's highlight, the card panel's room under its foot
  const own_ = (v: string) => /^(color|tw|text|radius|spacing|blur|shadow|font|default)-/.test(v) || ['c', 'c-subtle', 'c-strong', 'c-foreground', 'hl', 'pb'].includes(v);
  expect([...named].filter((v) => !light.has(v) && !own_(v))).toEqual([]);
  // the dark look redefines the colours that differ; it never defines one the light look lacks
  const dark = defined(':root:where([data-theme="dark"], :not([data-theme])[data-system-theme="dark"])');
  expect([...dark].filter((v) => !light.has(v))).toEqual([]);
});

// The colours are one palette in one file (tailwind.css, the token file): Tailwind's hues, shadcn's semantic tokens and
// the state tokens. A part takes them by name (`bg-waiting/10`, `text-c-strong`, `--alpha(var(--working)/22%)`); it writes
// no hex, rgb() or rgba() of its own, mixes none with color-mix(), and uses none of frost's former names (`text-ink`,
// `bg-chip`, `border-line`, `bg-panel`, `text-error`, `text-warn`, `text-on-ink`, `bg-dim`), now shadcn's.
test('colours come from the token file', async () => {
  // what is not a CSS colour, or is drawn into a canvas or an image where a token cannot reach: named with its reason
  const allowed: Record<string, string> = {
    'marks.ts': 'the marks drawn into a screenshot on a canvas, where CSS variables do not resolve',
  };
  const forbidden: [string, RegExp][] = [
    ['hex colour', /(?<![\w&])#[0-9a-fA-F]{3,8}\b/],
    ['rgb()/rgba()', /\brgba?\(/],
    ['color-mix()', /color-mix\(/],
    ['frost alias class', /(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|fill|stroke|shadow|outline|divide)-(?:ink|chip|line|panel|error|warn|on-ink|dim|online|ice)(?![\w-])/],
    // text in a state's colour takes its strong step: these fills fall short of 4.5:1 as small text on light glass (frost.test.ts measures them)
    ['state fill as text', /(?<![\w-])text-(?:planned|reviewing|waiting|in-pr|idea|asking|restart|\(--c\)|\[var\(--c\)\])(?![\w-])/],
    ['frost alias variable', /var\(--(?:ink|chip|line|panel|error|warn|on-ink|dim|online|ice|bg)\)/],
  ];
  const found: string[] = [];
  for (const file of new Glob('**/*.{ts,tsx,css,html}').scanSync(dir)) {
    if (file.includes('.test.') || file === 'tailwind.css' || allowed[file.split('/').pop()!]) continue;
    const text = await read(file);
    for (const [what, re] of forbidden) {
      // the token file alone mixes colours; frost.css and every view only name them
      const lines = text.split('\n').flatMap((l, i) => (re.test(l) ? [`${file}:${i + 1}`] : []));
      if (lines.length) found.push(`${what}: ${lines.slice(0, 5).join(' ')}`);
    }
  }
  // the token file itself writes hues from the palette: no hex or rgb() literal there either
  const own = await read('tailwind.css');
  for (const [what, re] of forbidden.slice(0, 2)) if (re.test(own.replace(/\/\*[\s\S]*?\*\//g, ''))) found.push(`${what}: tailwind.css`);
  expect(found).toEqual([]);
});

// Every menu, dialog, switch and select is a part of src/ui/components/ (shadcn on Radix), which brings its own
// role, keyboard and focus handling; a view that writes one itself leaves it out.
test('no bespoke control outside src/ui/components/', async () => {
  const bespoke = [/className="btn[ "]/g, /className="btn-(?!mark)/g, /role="switch"/g, /<select/g, /role="dialog"/g, /role="menu"/g, /useMenuClose/g];
  // the few places a part cannot do it, each counted with its reason: a further one in the same file still fails
  const allowed: Record<string, { needle: string; count: number; reason: string }[]> = {
    'phoneNext.tsx': [{ needle: '<select', count: 1, reason: "the top bar's project switcher, as the old phone view's: a native select over the project's name, so a finger gets the system picker" }],
    'phoneTalkPanel.tsx': [{ needle: 'role="dialog"', count: 1, reason: 'the phone\'s sheets (half or full height, dragged by their grip) are a dialog of their own' }],
    'fullPage.tsx': [{ needle: 'role="dialog"', count: 1, reason: 'a full page is a dialog landmark over the project, not a modal part' }],
    'chats.tsx': [{ needle: 'role="dialog"', count: 1, reason: 'the chats drawer is a docked panel that keeps the canvas usable' }],
    'desktopNotify.tsx': [{ needle: 'role="dialog"', count: 1, reason: 'the ask of the desktop notification is a card in the corner' }],
  };
  const found: string[] = [];
  for (const file of new Glob('**/*.{ts,tsx}').scanSync(dir)) {
    if (file.startsWith('components/') || file.includes('.test.')) continue;
    const text = await read(file);
    for (const needle of bespoke) {
      const count = text.match(needle)?.length ?? 0;
      const ok = allowed[file]?.find((a) => a.needle === needle.source)?.count ?? 0;
      if (count > ok) found.push(`${file}: ${needle.source} ×${count}`);
    }
  }
  expect(found).toEqual([]);
});

// `c-waiting`, `c-working` … each set the same `--c` properties, so two on one element are decided by the stylesheet's
// order, not by the class list: a part in components/ leaves the state colour to its caller instead of defaulting to one.
test('no component sets a state colour of its own', async () => {
  const found: string[] = [];
  for (const file of new Glob('components/**/*.tsx').scanSync(dir)) {
    if (file.includes('.test.')) continue;
    const text = await read(file);
    if (/(?<![\w-])c-(?:planned|working|reviewing|waiting|approved|inPr|live|proposal|idea|question|asking|restart|destructive|success|warning|info|muted)(?![\w-])/.test(text)) found.push(file);
  }
  expect(found).toEqual([]);
});
