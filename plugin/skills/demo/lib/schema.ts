// A schema-change page: the persisted data models a change touches, before and after, as one
// self-contained HTML page with an ER-style diagram (added green, changed amber, removed red) and a
// list of the changes and the source files they were read from. The worker reads the models out of
// whatever the project uses (SQL migrations, an ORM's models, …) into the JSON below; this script
// knows no dialect or ORM. Large schemas are cut to the affected entities and their direct
// neighbours.
//
//   node schema.ts <models.json> <page.html>
//
// models.json:
//   {
//     "title": "Feedback on approval",               (optional)
//     "sources": ["src/server/db.ts"],               the migrations or model files it was read from
//     "before": { "entities": [ … ] },
//     "after":  { "entities": [ … ] }
//   }
// an entity: { "kind": "table" | "columnar" | "document"?, "name": "cards", "was": "old_name"?, "fields": [ … ], "indexes": [ … ]? }
// a field:   { "name": "card_id", "type": "TEXT", "was": "old_name"?, "pk": true?, "unique": true?,
//              "nullable": true?, "default": "0"?, "ref": "cards" | "cards.id"? }
// an index:  { "name": "cards_state", "columns": ["state"], "unique": true? }
//
// Document fields may contain "fields": [ … ] for embedded objects or array items, and
// "optional": true. Nested fields render as property paths, e.g. profile.email.
//
// Plain Node with type stripping, like the director: no imports without extensions, no Bun APIs.

import fs from 'node:fs';
import { isMain } from './here.ts';
import { diffModels, type SchemaChange } from './schema-model.ts';
import { SchemaPage } from './schema-components.ts';
export * from './schema-model.ts';

/** Checks the input's shape, so a mistake in the worker's JSON says where it is. */
export function checkInput(x: unknown): SchemaChange {
  const fail = (what: string) => {
    throw new Error(`models.json: ${what}`);
  };
  const o = x as Partial<SchemaChange>;
  if (!o || typeof o !== 'object') fail('not an object');
  if (!Array.isArray(o.sources)) fail('"sources" must list the migrations or model files the models were read from');
  for (const side of ['before', 'after'] as const) {
    const m = o[side];
    if (!m || !Array.isArray(m.entities)) fail(`"${side}.entities" must be an array`);
    for (const e of m!.entities) {
      if (!e || typeof e.name !== 'string' || !e.name) fail(`an entity of "${side}" has no name`);
      if (!Array.isArray(e.fields)) fail(`"${side}" entity ${e.name} has no "fields" array`);
      if (e.kind !== undefined && !['table', 'columnar', 'document'].includes(e.kind)) fail(`the kind of ${side} entity ${e.name} must be table, columnar or document`);
      const fields = (items: import('./schema-model.ts').Field[], path: string) => {
        for (const f of items) {
          if (!f || typeof f.name !== 'string' || !f.name) fail(`a field of ${side} entity ${e.name} has no name`);
          if (f.fields !== undefined) {
            if (!Array.isArray(f.fields)) fail(`"${side}" field ${path}${f.name} needs a "fields" array`);
            fields(f.fields, `${path}${f.name}.`);
          }
        }
      };
      fields(e.fields, `${e.name}.`);
      if (e.indexes !== undefined && (!Array.isArray(e.indexes) || e.indexes.some((i) => !i || typeof i.name !== 'string' || !Array.isArray(i.columns))))
        fail(`the indexes of ${side} entity ${e.name} need a name and "columns"`);
    }
  }
  return o as SchemaChange;
}

/** The whole page, self-contained: nothing loaded from elsewhere. */
export const renderSchemaPage = SchemaPage;

if (isMain(import.meta.filename)) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    console.error('usage: node schema.ts <models.json> <page.html>');
    process.exit(2);
  }
  try {
    const input = checkInput(JSON.parse(fs.readFileSync(from, 'utf8')));
    const diffs = diffModels(input.before, input.after);
    fs.writeFileSync(to, renderSchemaPage(input, diffs));
    const changed = diffs.filter((d) => d.status !== 'same');
    console.log(changed.length ? `${to}: ${changed.map((d) => `${d.name} ${d.status}`).join(', ')}` : `${to}: no change to the models`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
