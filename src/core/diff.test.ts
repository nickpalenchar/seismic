import { describe, expect, test } from 'bun:test';
import { cardDiff, diffFiles, diffSize, lineDiff, PATCH_LIMIT, patchOf, splitDiff } from './diff';

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@ export function a',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '+const z = 4;',
  ' // --- not a header',
  'diff --git a/old name.md b/new name.md',
  'similarity index 90%',
  'rename from old name.md',
  'rename to new name.md',
  '--- a/old name.md',
  '+++ b/new name.md\t',
  '@@ -1 +1 @@',
  '-Hallo',
  '+Hallo Welt',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  'index 3333333..0000000',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-eins',
  '-zwei',
  'diff --git a/logo.png b/logo.png',
  'new file mode 100644',
  'index 0000000..4444444',
  'Binary files /dev/null and b/logo.png differ',
].join('\n');

describe('a card’s diff', () => {
  test('splits into files with what each adds and removes, new, deleted, renamed and binary ones told apart', () => {
    expect(diffFiles(patch)).toEqual([
      { file: 'src/a.ts', status: 'modified', added: 2, removed: 1 },
      { file: 'new name.md', from: 'old name.md', status: 'renamed', added: 1, removed: 1 },
      { file: 'gone.txt', status: 'deleted', added: 0, removed: 2 },
      { file: 'logo.png', status: 'added', added: 0, removed: 0, binary: true },
    ]);
    expect(diffSize(diffFiles(patch))).toEqual({ added: 3, removed: 4 });
    
    expect(splitDiff(patch)[0]!.lines).toHaveLength(10);
  });

  test('the version differs whenever a line does, also where the files and their counts stay the same', () => {
    const one = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
    const other = one.replace('+new', '+wen');
    expect(cardDiff('branch', one, false).files).toEqual(cardDiff('branch', other, false).files);
    expect(cardDiff('branch', one, false).version).not.toBe(cardDiff('branch', other, false).version);
    expect(cardDiff('branch', one, false).version).toBe(cardDiff('landed', one, true).version);
  });

  test('an empty diff has no files', () => {
    expect(diffFiles('')).toEqual([]);
  });

  test('the whole diff only when asked for, cut off at a file’s end past the limit', () => {
    expect(cardDiff('branch', patch, false)).toEqual({ source: 'branch', version: cardDiff('branch', patch, true).version!, files: diffFiles(patch) });
    expect(cardDiff('landed', patch, true).patch).toBe(patch);
    const big = `${patch}\n${`diff --git a/big.txt b/big.txt\n@@ -0,0 +1 @@\n+${'x'.repeat(PATCH_LIMIT)}`}`;
    const cut = cardDiff('branch', big, true);
    expect(cut.truncated).toBe(true);
    expect(cut.patch).toBe(patch);
    
    expect(cut.files.map((f) => f.file)).toContain('big.txt');
  });
});

test('two lists of lines as a diff: kept, gone and new in their order', () => {
  expect(lineDiff(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
    { kind: ' ', line: 'a' },
    { kind: '-', line: 'b' },
    { kind: '+', line: 'x' },
    { kind: ' ', line: 'c' },
    { kind: '+', line: 'd' },
  ]);
  expect(lineDiff([], ['a'])).toEqual([{ kind: '+', line: 'a' }]);
  expect(lineDiff(['a'], [])).toEqual([{ kind: '-', line: 'a' }]);
});

test('two lists of lines as a patch: each change with three lines around it, hunks whose context meets as one', () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const after = before.map((l, i) => (i === 9 ? 'changed 10' : i === 13 ? 'changed 14' : l)).filter((_, i) => i !== 26);
  const part = patchOf('f', before, after);
  expect(part.lines.filter((l) => l.startsWith('@@'))).toEqual(['@@ -7,11 +7,11 @@', '@@ -24,7 +24,6 @@']);
  expect(part.lines.slice(3, 6)).toEqual(['@@ -7,11 +7,11 @@', ' line 7', ' line 8']);
  expect([part.added, part.removed]).toEqual([2, 3]);
  
  expect(patchOf('f', [], ['a', 'b']).lines.slice(3)).toEqual(['@@ -0,0 +1,2 @@', '+a', '+b']);
  expect(patchOf('f', ['a'], ['a']).lines).toHaveLength(3);
});

test('a patch of a list too long to pass as arguments', () => {
  const long = Array.from({ length: 300_000 }, (_, i) => `line ${i}`);
  expect(patchOf('f', [], long).lines).toHaveLength(300_004);
});

test('two small changes far apart in a long list stay two changes, the lines between kept', () => {
  const long = Array.from({ length: 200_000 }, (_, i) => `line ${i}`);
  const edited = long.map((l, i) => (i === 1_000 ? 'one' : i === 150_000 ? 'two' : l));
  const started = performance.now();
  const d = lineDiff(long, edited);
  expect(performance.now() - started).toBeLessThan(2_000);
  expect(d.filter((x) => x.kind !== ' ').map((x) => x.kind + x.line)).toEqual(['-line 1000', '+one', '-line 150000', '+two']);
});

test('lists too unlike for the budget are anchored on the lines found once in each', () => {
  
  const before = Array.from({ length: 40_000 }, (_, i) => (i % 2 ? `old ${i}` : `same ${i}`));
  const after = before.map((l, i) => (i % 2 ? `new ${i}` : l));
  const d = lineDiff(before, after);
  expect(d.filter((x) => x.kind === ' ')).toHaveLength(20_000);
  expect(d.filter((x) => x.kind === '-')).toHaveLength(20_000);
});

test('a last line without a line feed is marked, and gaining one is a change', () => {
  expect(patchOf('f', ['a', 'b'], ['a', 'b'], { ends: { old: false, new: true } }).lines.slice(3)).toEqual(['@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b']);
  expect(patchOf('f', ['a'], ['x'], { ends: { old: false, new: false } }).lines.slice(3)).toEqual(['@@ -1,1 +1,1 @@', '-a', '\\ No newline at end of file', '+x', '\\ No newline at end of file']);
});
