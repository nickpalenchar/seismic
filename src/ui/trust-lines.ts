// The commands a repository asks the owner to trust, as the lines of their diff: by file or command,
// each character that shows nothing written as a marker.

import type { RepoCommands, TrustGroup } from '../core/types';

/** A group's commands by name: the Claude Code or Codex configuration's text by file, the app's commands by field. */
export function textsOf(c: RepoCommands | undefined, group: TrustGroup): Record<string, string> {
  if (group === 'app') return Object.fromEntries(Object.entries(c?.app ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return Object.fromEntries(Object.entries(c?.[group] ?? {}).map(([file, f]) => [file, f.text]));
}

/**
 * A text's lines as the view shows them: split at each line feed alone, the one break the patch
 * knows, and every other character that shows nothing or breaks a line written as a marker, so a
 * carriage return, a line separator or a zero-width space changed is a line changed, and seen.
 * `ends`: whether the last line ends with a line feed, which then makes no empty line of its own.
 */
export function linesOf(text: string | undefined): { lines: string[]; ends: boolean } {
  if (!text) return { lines: [], ends: true };
  const lines = text.split('\n').map(visible);
  const ends = text.endsWith('\n');
  if (ends) lines.pop();
  return { lines, ends };
}

/** A file's extension, for its highlighting; none where it holds more than letters and digits. */
export const extension = (file: string) => /\.[A-Za-z0-9]+$/.exec(file)?.[0] ?? '';

// the marker's own opening bracket is written as a marker too, so a text that holds one reads apart
// from the character it would stand for
const INVISIBLE = /(?![\t ])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\u27e8]/gu;
const NAMED: Record<string, string> = { '\r': 'CR', '\u2028': 'LS', '\u2029': 'PS', '\u00a0': 'NBSP' };
export const visible = (line: string) => line.replace(INVISIBLE, (c) => `⟨${NAMED[c] ?? `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`}⟩`);
