import { expect, test } from 'bun:test';
import type { ChangeRow } from '../core/files';
import { diffTreeEntries, treeOrder } from './diff-tree-entries';

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
      expect(treeOrder(input).map(r => r.path).sort()).toEqual(rows.map(r => r.path).sort());
      const foo = diffTreeEntries(input).find(e => e.path === 'foo')!;
      expect(foo.file).toEqual({ path: 'foo', kind: parentKind });
      expect(foo.children).toEqual([{ path: 'foo/bar', kind: childKind }]);
    }
  });
}

test('the tree order lists the files as the tree shows them, by name at each level', () => {
  const rows: ChangeRow[] = [
    { path: 'src/old.ts', kind: 'deleted' },
    { path: 'src/project-name.ts', kind: 'moved' },
    { path: 'src/components/navigation.ts', kind: 'added' },
    { path: 'src/app.ts', kind: 'modified' },
    { path: 'docs/navigation.md', kind: 'added' },
  ];
  expect(treeOrder(rows).map(r => r.path)).toEqual(['docs/navigation.md', 'src/app.ts', 'src/components/navigation.ts', 'src/old.ts', 'src/project-name.ts']);
});
