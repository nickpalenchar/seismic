import { expect, test } from 'bun:test';
import type { ChangeRow } from '../core/files';
import { diffTreeEntries } from './diff-tree-entries';

function leaves(rows: ChangeRow[], prefix = ''): ChangeRow[] {
  return diffTreeEntries(rows, prefix).flatMap(entry => [
    ...(entry.file ? [entry.file] : []),
    ...leaves(entry.children, `${entry.path}/`),
  ]);
}

for (const [parentKind, childKind] of [['deleted', 'added'], ['added', 'deleted']] as const) {
  test(`${parentKind} file and ${childKind} descendants stay independently selectable`, () => {
    const rows: ChangeRow[] = [
      { path: 'foo/bar', kind: childKind },
      { path: 'foo', kind: parentKind },
      { path: 'nested/foo', kind: parentKind },
      { path: 'nested/foo/bar/baz', kind: childKind },
      { path: 'nested/foo/bar', kind: parentKind },
      { path: 'ordinary.txt', kind: 'modified' },
    ];
    for (const input of [rows, rows.toReversed()]) {
      expect(leaves(input).map(r => r.path).sort()).toEqual(rows.map(r => r.path).sort());
      const foo = diffTreeEntries(input).find(e => e.path === 'foo')!;
      expect(foo.file).toEqual({ path: 'foo', kind: parentKind });
      expect(foo.children).toEqual([{ path: 'foo/bar', kind: childKind }]);
    }
  });
}
