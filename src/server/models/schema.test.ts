import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { Store } from '../db';
import * as schema from './schema';

/**
 * What SQLite says of a database's tables: each one's columns in order, its foreign keys and its
 * indexes. Where drizzle-kit writes the same thing differently, both read the same: a unique
 * constraint is a unique index under a name of its own (`<table>_<columns>_unique`); a boolean
 * column's default is `false` rather than `0`; and a primary key column is always `NOT NULL` (the
 * migrations left a TEXT key nullable, which SQLite allows; nothing stores a null key).
 */
function shape(db: Database) {
  const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  return Object.fromEntries(
    tables.map((t) => {
      const columns = (db.query(`PRAGMA table_xinfo("${t}")`).all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[]).map(
        (c) => {
          const dflt = c.dflt_value === 'false' ? '0' : c.dflt_value === 'true' ? '1' : c.dflt_value;
          return `${c.name} ${c.type.toLowerCase()}${c.notnull && !c.pk ? ' not null' : ''}${dflt !== null ? ` default ${dflt}` : ''}${c.pk ? ` pk${c.pk}` : ''}`;
        },
      );
      const foreignKeys = (db.query(`PRAGMA foreign_key_list("${t}")`).all() as { table: string; from: string; to: string | null; on_update: string; on_delete: string }[])
        .map((k) => `${k.from} → ${k.table}.${k.to ?? '(pk)'} on update ${k.on_update.toLowerCase()} on delete ${k.on_delete.toLowerCase()}`)
        .sort();
      const indexes = (db.query(`PRAGMA index_list("${t}")`).all() as { name: string; unique: number; origin: string }[])
        .filter((i) => i.origin !== 'pk')
        .map((i) => {
          const keys = (db.query(`PRAGMA index_xinfo("${i.name}")`).all() as { name: string | null; desc: number; coll: string; key: number }[])
            .filter((k) => k.key)
            .map((k) => `${k.name}${k.desc ? ' desc' : ''}${k.coll !== 'BINARY' ? ` collate ${k.coll.toLowerCase()}` : ''}`);
          const sql = (db.query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = $n").get({ n: i.name }) as { sql: string | null } | null)?.sql;
          const where = sql?.match(/\swhere\s([\s\S]*)$/i)?.[1]?.replace(/\s+/g, ' ').trim();
          const named = i.origin === 'c' && !i.name.endsWith('_unique');
          return `${named ? `${i.name}: ` : ''}${i.unique ? 'unique ' : ''}(${keys.join(', ')})${where ? ` where ${where}` : ''}`;
        })
        .sort();
      return [t, { columns, foreignKeys, indexes }];
    }),
  );
}

describe('the Drizzle schema (models/)', () => {
  test('describes the database the migrations build from scratch', async () => {
    const migrated = new Store(':memory:').db;
    const ddl = await generateSQLiteMigration(await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(schema));
    const described = new Database(':memory:');
    for (const statement of ddl) described.run(statement);
    expect(shape(described)).toEqual(shape(migrated));
  });
});
