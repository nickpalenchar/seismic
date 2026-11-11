import type { ChangeRow } from '../core/files';

/** A path can be both a changed file and a directory prefix across the two revisions. */
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
