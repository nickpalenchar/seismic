import type { ChangeRow } from '../core/files';


export interface DiffTreeEntry {
  name: string;
  path: string;
  file?: ChangeRow;
  children: ChangeRow[];
}

export function diffTreeEntries(rows: ChangeRow[], prefix = ''): DiffTreeEntry[] {
  const groups = new Map<string, DiffTreeEntry>();
  for (const row of rows) {
    const name = row.path.slice(prefix.length).split('/')[0]!;
    const path = prefix + name;
    let entry = groups.get(name);
    if (!entry) groups.set(name, entry = { name, path, children: [] });
    if (row.path === path) entry.file = row;
    else entry.children.push(row);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The files in the order the tree shows them, a file before what lies beneath its path. */
export function treeOrder(rows: ChangeRow[], prefix = ''): ChangeRow[] {
  return diffTreeEntries(rows, prefix).flatMap(entry => [
    ...(entry.file ? [entry.file] : []),
    ...treeOrder(entry.children, `${entry.path}/`),
  ]);
}
