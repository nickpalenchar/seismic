// Syntax highlighting for code blocks, as shadcn/ui's code block does it: Shiki on its JavaScript
// regex engine (no WebAssembly), GitHub's light and dark themes at once as CSS variables, so a token's
// colour follows the page's theme without highlighting again. A language loads the first time a file
// of it is shown.

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';

/** A run of a line's text in one colour: `style` sets `--shiki-light` and `--shiki-dark`. */
export interface Token {
  content: string;
  style?: Record<string, string>;
}

/** Extensions and file names Shiki knows by no name or alias of a language. */
const NAMES: Record<string, string> = { h: 'c', dockerfile: 'docker', makefile: 'make', gnumakefile: 'make', cmakelists: 'cmake' };

/** The language of a file by its name, or null for one Shiki does not know. */
export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  for (const key of [dot > 0 ? name.slice(dot + 1) : '', name, name.replace(/\.txt$/, '')]) {
    const lang = NAMES[key] ?? key;
    if (lang && lang in bundledLanguages) return lang;
  }
  return null;
}

let shiki: Promise<HighlighterCore> | undefined;

function highlighter() {
  shiki ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return shiki;
}

/** Tokenizes code in a language, one array of tokens per line; null for a language Shiki does not know. */
export async function loadTokenizer(lang: string | null): Promise<((code: string) => Token[][]) | null> {
  if (!lang || !(lang in bundledLanguages)) return null;
  const core = await highlighter();
  if (!core.getLoadedLanguages().includes(lang)) await core.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages]);
  return (code) =>
    core
      .codeToTokens(code, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false, tokenizeMaxLineLength: 2000 })
      .tokens.map((line) => line.map((t) => ({ content: t.content, style: t.htmlStyle as Record<string, string> | undefined })));
}
