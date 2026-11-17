import type { Changes, Database } from 'bun:sqlite';
import { getTableColumns, type SQL, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

// What every model shares: the connection it queries through and a few helpers for it.

/** The Drizzle connection the models query through: the store's own SQLite connection, so they share its transactions. */
export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

/** How many hex digits of its id a card's code has at least. */
export const SHORT = 6;

/**
 * Runs `fn` in one transaction of the shared connection, or (within one already) in a savepoint of
 * it. Drizzle's own `transaction` opens with `BEGIN`, which cannot nest; SQLite's savepoints can.
 */
export function atomic<T>(db: Db, fn: () => T): T {
  return db.$client.transaction(fn)();
}

/**
 * A table's columns under their names in the database, as stored (JSON as its text, a boolean as 0
 * or 1): selected, they read the row as `SELECT *` does. For the rows whose callers still parse
 * them themselves (`CardRow`).
 */
export function stored(table: SQLiteTable): Record<string, SQL> {
  return Object.fromEntries(Object.values(getTableColumns(table)).map((c) => [c.name, sql`${c}`]));
}

export const now = () => new Date().toISOString();

/** How many rows a write changed: what `run()` returns on this driver, though Drizzle types it as nothing. */
export const changes = (result: unknown): number => (result as Changes).changes;
