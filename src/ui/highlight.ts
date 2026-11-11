// Shiki on its JavaScript regex engine: languages and the active GitHub theme load on demand.
// Tokenizers retain their chosen theme even when another diff requests a different one.

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';
import type { Theme } from '../core/types';
import type { DiffLine, Hunk } from './diff-lines';

/** A run of a line's text in one colour: `style` sets its active theme colour. */
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
    themes: [],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return shiki;
}

/** Tokenizes code in a language, one array of tokens per line; null for a language Shiki does not know. */
export async function loadTokenizer(lang: string | null, theme: Theme): Promise<((code: string) => Token[][]) | null> {
  if (!lang || !(lang in bundledLanguages)) return null;
  const core = await highlighter();
  if (!core.getLoadedLanguages().includes(lang)) await core.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages]);
  const name = theme === 'dark' ? 'github-dark' : 'github-light';
  if (!core.getLoadedThemes().includes(name)) await core.loadTheme(bundledThemes[name]);
  return (code) =>
    core
      .codeToTokens(code, { lang, theme: name, tokenizeMaxLineLength: 2000 })
      .tokens.map((line) => line.map((t) => ({ content: t.content, style: { color: t.color ?? 'inherit' } })));
}

/** Tokenize only contiguous source on each side: omitted lines cannot carry grammar state. */
export function paintHunks(hunks: Hunk[], tokenize: (code: string) => Token[][]) {
  const side = (which: 'old' | 'new') => {
    const result = new Map<number, Token[]>();
    let run: DiffLine[] = [];
    const flush = () => {
      if (!run.length) return;
      const tokens = tokenize(run.map((l) => l.text).join('\n'));
      run.forEach((line, i) => result.set(line[which]!, tokens[i] ?? []));
      run = [];
    };
    for (const hunk of hunks) for (const line of hunk.lines) {
      const n = line[which];
      if (n === undefined) continue;
      if (run.length && n !== run.at(-1)![which]! + 1) flush();
      run.push(line);
    }
    flush();
    return result;
  };
  return { old: side('old'), new: side('new') };
}
