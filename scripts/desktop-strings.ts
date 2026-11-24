// The strings of the pages the desktop shell bundles (desktop/ui/), written from src/ui/strings.ts
// (`desktopPages`) into desktop/ui/strings.js. Those pages load from the app itself before any server
// answers, so they cannot ask one for their text, and Tauri embeds desktop/ui as it is: the file is
// committed, and scripts/desktop-strings.test.ts fails while it lags behind strings.ts.
//
//   bun scripts/desktop-strings.ts
//
// A function there becomes a template with {0}, {1} … for its arguments; the page fills them in.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../src/ui/strings';

export const DESKTOP_STRINGS = join(import.meta.dir, '..', 'desktop', 'ui', 'strings.js');

type Template = string | { [key: string]: Template };

function templates(value: unknown, path: string): Template {
  if (typeof value === 'string') return value;
  if (typeof value === 'function') {
    const marks = Array.from({ length: value.length }, (_, i) => `\u0000${i}\u0000`);
    const text = value(...marks);
    if (typeof text !== 'string') throw new Error(`${path} gives no string`);
    if (/\{\d+\}/.test(text)) throw new Error(`${path} has {n} of its own, which the page would fill in`);
    return text.replace(/\u0000(\d+)\u0000/g, '{$1}');
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, templates(v, `${path}.${k}`)]));
  throw new Error(`${path} is neither text nor a group of it`);
}

/** The contents of desktop/ui/strings.js. */
export const desktopStrings = () =>
  `// Written by scripts/desktop-strings.ts from desktopPages in src/ui/strings.ts; change it there.\n` +
  `window.SEISMIC_STRINGS = ${JSON.stringify(templates(t.desktopPages, 'desktopPages'), null, 2)};\n` +
  `/** A template's {0}, {1} … filled in with the values, in that order. */\n` +
  `window.fillString = (template, ...values) => template.replace(/\\{(\\d+)\\}/g, (_, i) => values[i]);\n`;

if (import.meta.main) {
  writeFileSync(DESKTOP_STRINGS, desktopStrings());
  console.log(`wrote ${DESKTOP_STRINGS}`);
}
