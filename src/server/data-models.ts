// Signs that a card's change alters the data its project persists, read at its handover from the
// branch's diff: a tripwire beside the worker's own declaration (`data_models`), so that a model
// change does not reach the owner without its schema-change page. Generic signals only (DDL, the
// usual migration and schema files, the usual migration calls of ORMs): Seismic cannot know how a
// repository defines its models, and a false alarm costs the worker one more call.

/** A file of the change that looks like it alters persisted models, with what gave it away. */
export interface DataSignal {
  file: string;
  why: string;
}

/** Paths that hold persisted models or their migrations, whatever the change in them. */
const PATHS: [RegExp, string][] = [
  [/\.sql$/i, 'an SQL file'],
  [/(^|\/)(migrations?|migrate|alembic)\//i, 'a migrations directory'],
  [/\.prisma$/i, 'a Prisma schema'],
  [/(^|\/)schema\.rb$/, 'a Rails schema'],
  [/(^|\/)models\.py$/, 'Django models'],
  [/\.entity\.[cm]?[jt]s$/, 'an ORM entity'],
];

/** Added lines that read like DDL or an ORM's migration calls. */
const LINES: RegExp[] = [
  /\b(create|alter|drop)\s+(temporary\s+|temp\s+|virtual\s+)?(table|view|index)\b/i,
  /\bcreate\s+unique\s+index\b/i,
  /\b(add|drop|rename)\s+column\b/i,
  /\bforeign\s+key\b/i,
  /\b(create_table|drop_table|add_column|remove_column|rename_column|alter_column|add_index|create_index|add_foreign_key)\b/,
  /\b(createTable|dropTable|alterTable|addColumn|removeColumn|renameColumn|changeColumn|addIndex)\s*\(/,
  /\bmigrations\.(CreateModel|DeleteModel|AddField|RemoveField|AlterField|RenameField|RenameModel)\b/,
];

/** Prose about a migration is no migration. */
const PROSE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;

/** How many files a refusal names. */
export const SIGNALS_NAMED = 8;

/** The files of `patch` (a `git diff`, new files against nothing) that look like they alter persisted models, each once. */
export function dataModelSignals(patch: string): DataSignal[] {
  const out = new Map<string, string>();
  let file = '';
  let header = false;
  for (const line of patch.split('\n')) {
    const start = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (start) {
      file = start[1]!;
      header = true;
      const path = PATHS.find(([re]) => re.test(file));
      if (path && !PROSE.test(file)) out.set(file, path[1]);
      continue;
    }
    if (header) {
      if (line.startsWith('+++ b/')) file = line.slice(6);
      if (line.startsWith('@@')) header = false;
      continue;
    }
    if (!file || out.has(file) || PROSE.test(file) || !line.startsWith('+')) continue;
    const hit = LINES.map((re) => re.exec(line)).find(Boolean);
    if (hit) out.set(file, `adds “${hit[0].replace(/\s+/g, ' ').replace(/\s*\($/, '')}”`);
  }
  return [...out].map(([file, why]) => ({ file, why }));
}

/** Whether a file named at a handover is the schema-change page the demo skill renders. */
export const isSchemaPage = (path: string) => /(^|\/)[^/]*schema[^/]*\.html?$/i.test(path);
