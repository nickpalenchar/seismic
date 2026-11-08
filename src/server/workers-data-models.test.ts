import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataModelSignals, isSchemaPage } from './data-models';
import { artifact } from './testing';
import { board, eachTest, manual, runtime, workers } from './workers-fixture';
import { git } from './workstations';

eachTest();

/** A card at work whose branch commits `files`. */
async function cardWith(files: Record<string, string>) {
  const c = manual();
  await workers.start(c.id);
  const ws = board.row(c.id).workstation!;
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(ws, file)), { recursive: true });
    writeFileSync(join(ws, file), text);
  }
  git(ws, 'add', '-A');
  git(ws, 'commit', '--quiet', '-m', 'change');
  return c;
}

const MIGRATION = { 'src/db.ts': "const migrations = [\n  'ALTER TABLE cards ADD COLUMN app TEXT;',\n];\n" };

describe('signs of a data-model change in a diff', () => {
  test('DDL and ORM migration calls in added lines, migration and schema files by their path; prose and removed lines are none', () => {
    const patch = [
      'diff --git a/src/db.ts b/src/db.ts',
      '--- a/src/db.ts',
      '+++ b/src/db.ts',
      '@@ -1,0 +2,1 @@',
      "+  'create unique index cards_slug ON cards(slug);',",
      'diff --git a/db/migrate/001_init.rb b/db/migrate/001_init.rb',
      'new file mode 100644',
      'diff --git a/app/models.ts b/app/models.ts',
      '+++ b/app/models.ts',
      '@@ -3 +3 @@',
      '-  DROP TABLE old;',
      '+  knex.schema.createTable("users", (t) => {});',
      'diff --git a/docs/notes.md b/docs/notes.md',
      '+++ b/docs/notes.md',
      '@@ -1 +1 @@',
      '+We CREATE TABLE here.',
      'diff --git a/src/ui.ts b/src/ui.ts',
      '+++ b/src/ui.ts',
      '@@ -1 +1 @@',
      '-ALTER TABLE x ADD COLUMN y;',
      '+const table = createTableView();',
    ].join('\n');
    expect(dataModelSignals(patch)).toEqual([
      { file: 'src/db.ts', why: 'adds “create unique index”' },
      { file: 'db/migrate/001_init.rb', why: 'a migrations directory' },
      { file: 'app/models.ts', why: 'adds “createTable”' },
    ]);
    expect(dataModelSignals('')).toEqual([]);
  });

  test('the schema-change page is known by its name', () => {
    expect(isSchemaPage('schema-change.html')).toBe(true);
    expect(isSchemaPage('pages/db-schema.htm')).toBe(true);
    expect(isSchemaPage('index.html')).toBe(false);
    expect(isSchemaPage('schema.json')).toBe(false);
  });
});

describe('a handover says whether its change alters persisted data models', () => {
  test("'changed' needs the schema-change page among the files, named now or before", async () => {
    const c = await cardWith(MIGRATION);
    const demo = artifact();
    const refused = await runtime.last.call('ready_for_review', { summary: 'S', demo, data_models: 'changed' });
    expect(refused).toContain('no schema-change page is among the files');
    expect(refused).toContain('A change to persisted data models');
    expect(board.item(c.id)!.state).toBe('working');
    writeFileSync(join(demo.dir, 'schema-change.html'), '<p>schema</p>');
    expect(await runtime.last.call('ready_for_review', { summary: 'S', demo, data_models: 'changed', files: [{ path: join(demo.dir, 'schema-change.html'), caption: 'Schema' }] })).toContain('Recorded');
    expect(board.item(c.id)!.review?.modelsUnchanged).toBeUndefined();
    // a later handover keeps the page named before
    workers.message(c.id, 'Noch einmal.');
    expect(await runtime.last.call('ready_for_review', { summary: 'S', data_models: 'changed' })).toContain('Recorded');
  });

  test("'unchanged' where the branch shows a migration is refused once, naming the files; the second call stands, with its reason on the card", async () => {
    const c = await cardWith(MIGRATION);
    const call = () => runtime.last.call('ready_for_review', { summary: 'S', demo: artifact(), data_models: 'unchanged', data_models_reason: 'Nur ein Test-Fixture.' });
    const refused = await call();
    expect(refused).toContain('Not handed over: your branch looks like it alters persisted data models: src/db.ts (adds “ALTER TABLE”)');
    expect(refused).toContain("data_models 'unchanged' and the reason");
    expect(board.item(c.id)!.state).toBe('working');
    expect(await call()).toContain('Recorded');
    expect(board.item(c.id)!.review?.modelsUnchanged).toBe('Nur ein Test-Fixture.');
  });

  test("'unchanged' takes its reason; a change with no signs needs nothing more", async () => {
    const c = await cardWith({ 'src/app.ts': 'export const x = 1;\n' });
    expect(await runtime.last.call('ready_for_review', { summary: 'S', demo: artifact(), data_models: 'unchanged' })).toContain('takes its reason');
    expect(await runtime.last.call('ready_for_review', { summary: 'S', demo: artifact(), data_models: 'unchanged', data_models_reason: 'Nur UI.' })).toContain('Recorded');
    // no signs: nothing for the owner to judge
    expect(board.item(c.id)!.review?.modelsUnchanged).toBeUndefined();
  });

  test('files that show signs only later are refused once again', async () => {
    const c = await cardWith(MIGRATION);
    const call = () => runtime.last.call('ready_for_review', { summary: 'S', demo: artifact(), data_models: 'unchanged', data_models_reason: 'Fixture.' });
    expect(await call()).toContain('Not handed over');
    expect(await call()).toContain('Recorded');
    workers.message(c.id, 'Noch eine Tabelle.');
    const ws = board.row(c.id).workstation!;
    writeFileSync(join(ws, 'schema.sql'), 'CREATE TABLE t (id INTEGER);\n');
    git(ws, 'add', '-A');
    git(ws, 'commit', '--quiet', '-m', 'table');
    const again = await call();
    expect(again).toContain('schema.sql (an SQL file)');
    expect(await call()).toContain('Recorded');
  });
});
