

























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
