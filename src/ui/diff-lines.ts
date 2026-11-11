// A file's diff as lines to draw: its hunks read from the patch, the unchanged lines between and
// around them once the whole file is there, the pairs of a split layout, and the words that changed
// within a changed line.

import { diffWordsWithSpace } from 'diff';

export type LineKind = 'context' | 'added' | 'removed';

/** A line of the diff, with its number in the old file, the new one, or both. */
export interface DiffLine {
  kind: LineKind;
  text: string;
  old?: number;
  new?: number;
  /** Where the line differs from the one it replaces or is replaced by: `[from, to)` in `text`. */
  marks?: [number, number][];
  /** The file ends with this line, without a newline after it. */
  noEol?: true;
}

export interface Hunk {
  /** First line in the old and the new file (the line before it where the hunk takes none from that side). */
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** What git names after the hunk's numbers: the function or heading it is in. */
  section: string;
  lines: DiffLine[];
}

const HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** The hunks of one file's part of a `git diff` (its lines from `diff --git` on), changed words marked. */
export function parseHunks(patch: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let hunk: Hunk | undefined;
  let old = 0;
  let neu = 0;
  let left = { old: 0, new: 0 };
  for (const line of patch) {
    const head = HEAD.exec(line);
    if (head) {
      const [oldStart, oldCount, newStart, newCount] = [head[1], head[2] ?? '1', head[3], head[4] ?? '1'].map(Number) as [number, number, number, number];
      hunk = { oldStart, oldCount, newStart, newCount, section: head[5]!.trim(), lines: [] };
      hunks.push(hunk);
      old = oldCount ? oldStart : oldStart + 1;
      neu = newCount ? newStart : newStart + 1;
      left = { old: oldCount, new: newCount };
      continue;
    }
    if (hunk && line.startsWith('\\')) {
      // `\ No newline at end of file`, about the line before it
      const last = hunk.lines.at(-1);
      if (last) last.noEol = true;
      continue;
    }
    if (!hunk || (left.old <= 0 && left.new <= 0)) continue;
    const sign = line[0];
    const text = line.slice(1);
    if (sign === '-') {
      hunk.lines.push({ kind: 'removed', text, old: old++ });
      left.old--;
    } else if (sign === '+') {
      hunk.lines.push({ kind: 'added', text, new: neu++ });
      left.new--;
    } else if (sign === ' ' || line === '') {
      // a blank context line may have lost its space on the way
      hunk.lines.push({ kind: 'context', text, old: old++, new: neu++ });
      left.old--;
      left.new--;
    }
  }
  for (const h of hunks) markWords(h.lines);
  return hunks;
}

/** The first line a hunk covers on each side, and the one after its last. */
export function span(h: Hunk) {
  const oldFrom = h.oldCount ? h.oldStart : h.oldStart + 1;
  const newFrom = h.newCount ? h.newStart : h.newStart + 1;
  return { oldFrom, oldTo: oldFrom + h.oldCount, newFrom, newTo: newFrom + h.newCount };
}

/**
 * The unchanged lines before hunk `i` (`i === hunks.length`: after the last one), as new-file line
 * numbers `[from, to)` and how far the old file's numbers lag behind; `to` is null after the last
 * hunk while the file's length is not known.
 */
export function gap(hunks: Hunk[], i: number, newLength?: number): { from: number; to: number | null; shift: number } {
  const prev = i > 0 ? span(hunks[i - 1]!) : { oldTo: 1, newTo: 1 };
  const next = i < hunks.length ? span(hunks[i]!) : null;
  return { from: prev.newTo, to: next ? next.newFrom : newLength === undefined ? null : newLength + 1, shift: prev.newTo - prev.oldTo };
}

/** The unchanged lines `[from, to)` of the new file, numbered on both sides. */
export function contextLines(file: string[], from: number, to: number, shift: number): DiffLine[] {
  const out: DiffLine[] = [];
  for (let n = from; n < to && n <= file.length; n++) out.push({ kind: 'context', text: file[n - 1]!, old: n - shift, new: n });
  return out;
}

/** A file's text as its lines, without the empty one after a final newline. */
export function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** One row of a split diff: the old file's line on the left, the new one's on the right; a side without one is empty. */
export interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

/** Lines laid out side by side: an unchanged line on both sides, a run of removed lines beside the added lines that replace them. */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (line.kind === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (lines[i]?.kind === 'removed') removed.push(lines[i++]!);
    while (lines[i]?.kind === 'added') added.push(lines[i++]!);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) rows.push({ left: removed[k], right: added[k] });
  }
  return rows;
}

/** Marks, on each removed line and the added line paired with it, the words that differ, where the two still share most of their text. */
function markWords(lines: DiffLine[]) {
  for (const { left, right } of splitRows(lines)) {
    if (!left || !right || left === right) continue;
    if (left.text.length + right.text.length > 4000) continue;
    const parts = diffWordsWithSpace(left.text, right.text);
    const shared = parts.reduce((n, p) => (p.added || p.removed ? n : n + p.value.trim().length), 0);
    if (shared * 2 < Math.max(left.text.trim().length, right.text.trim().length)) continue;
    const oldMarks: [number, number][] = [];
    const newMarks: [number, number][] = [];
    let o = 0;
    let n = 0;
    for (const p of parts) {
      const len = p.value.length;
      if (p.removed) oldMarks.push([o, (o += len)]);
      else if (p.added) newMarks.push([n, (n += len)]);
      else {
        o += len;
        n += len;
      }
    }
    if (oldMarks.length) left.marks = oldMarks;
    if (newMarks.length) right.marks = newMarks;
  }
}
