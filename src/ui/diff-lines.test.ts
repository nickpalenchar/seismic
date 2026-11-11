import { expect, test } from 'bun:test';
import { contextLines, gap, parseHunks, splitLines, splitRows } from './diff-lines';
import { languageOf } from './highlight';

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -3,4 +3,4 @@ export function greet() {',
  ' const a = 1;',
  '-const name = "world";',
  '+const name = "there";',
  ' const b = 2;',
  '',
  '@@ -20,2 +20,3 @@',
  ' x();',
  '+--y();',
  ' z();',
  '\\ No newline at end of file',
];

test('a patch reads as hunks, each line numbered on its sides, a blank context line kept', () => {
  const hunks = parseHunks(patch);
  expect(hunks.map((h) => [h.oldStart, h.newStart, h.section])).toEqual([
    [3, 3, 'export function greet() {'],
    [20, 20, ''],
  ]);
  expect(hunks[0]!.lines.map((l) => [l.kind, l.old, l.new])).toEqual([
    ['context', 3, 3],
    ['removed', 4, undefined],
    ['added', undefined, 4],
    ['context', 5, 5],
    ['context', 6, 6],
  ]);
  // a line starting with `--` inside a hunk is an added line, not a file header
  expect(hunks[1]!.lines.map((l) => [l.kind, l.text])).toEqual([
    ['context', 'x();'],
    ['added', '--y();'],
    ['context', 'z();'],
  ]);  // the marker after the last line says no newline follows it
  expect(hunks[1]!.lines.at(-1)!.noEol).toBe(true);
  expect(hunks[1]!.lines.filter((l) => l.noEol)).toHaveLength(1);
});

test('a changed line marks the words that differ from the line it replaces', () => {
  const [removed, added] = parseHunks(patch)[0]!.lines.slice(1, 3);
  const marked = (l: typeof removed) => l!.marks!.map(([a, b]) => l!.text.slice(a, b));
  expect(marked(removed)).toEqual(['world']);
  expect(marked(added)).toEqual(['there']);
  // a line rewritten through and through gets no marks
  const [old, neu] = parseHunks(['@@ -1 +1 @@', '-alpha beta gamma', '+completely other words']).at(0)!.lines;
  expect(old!.marks).toBeUndefined();
  expect(neu!.marks).toBeUndefined();
});

test('the unchanged lines between hunks and after the last come from the new file, numbered on both sides', () => {
  const hunks = parseHunks(['@@ -3,2 +3,3 @@', ' c', '+new', ' d', '@@ -10,1 +11,1 @@', '-j', '+J']);
  expect(gap(hunks, 0)).toEqual({ from: 1, to: 3, shift: 0 });
  expect(gap(hunks, 1)).toEqual({ from: 6, to: 11, shift: 1 });
  expect(gap(hunks, 2)).toEqual({ from: 12, to: null, shift: 1 });
  const file = splitLines('1\n2\nc\nnew\nd\n6\n7\n8\n9\n10\nJ\n12\n13\n');
  expect(gap(hunks, 2, file.length)).toEqual({ from: 12, to: 14, shift: 1 });
  expect(contextLines(file, 12, 14, 1).map((l) => [l.text, l.old, l.new])).toEqual([
    ['12', 11, 12],
    ['13', 12, 13],
  ]);
  // a new file's hunk starts at line 0 of the old side
  expect(gap(parseHunks(['@@ -0,0 +1,2 @@', '+a', '+b']), 0)).toEqual({ from: 1, to: 1, shift: 0 });
});

test('a split layout puts removed lines beside the added ones that replace them', () => {
  const rows = splitRows(parseHunks(['@@ -1,5 +1,3 @@', ' a', '-b', '-c', '+B', ' d', '-e']).at(0)!.lines);
  expect(rows.map((r) => [r.left?.text, r.right?.text])).toEqual([
    ['a', 'a'],
    ['b', 'B'],
    ['c', undefined],
    ['d', 'd'],
    ['e', undefined],
  ]);
});

test('a file’s language comes from its extension or name', () => {
  expect(['src/ui/a.tsx', 'x.py', 'Dockerfile', 'lib/b.h', 'README.md', 'notes.unknown'].map(languageOf)).toEqual(['tsx', 'py', 'docker', 'c', 'md', null]);
});
