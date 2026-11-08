import { eq } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from '../common';

// What the tables of a card's parts share: one row per card, there once any of it is set.

/**
 * Sets fields of the card's part in `table` (keyed by `cardId`): its row comes once any field
 * differs from `empty`, and goes once none does.
 */
export function setPart<T extends Record<string, unknown>>(db: Db, table: SQLiteTable & { cardId: SQLiteColumn }, empty: T, cardId: string, fields: Partial<T>) {
  if (!Object.keys(fields).length) return;
  const was = db.select().from(table).where(eq(table.cardId, cardId)).get() as (T & { cardId: string }) | undefined;
  const { cardId: _, ...next } = { ...empty, ...was, ...fields } as T & { cardId?: string };
  const none = Object.entries(next).every(([k, v]) => v === undefined || v === empty[k]);
  if (none) {
    if (was) db.delete(table).where(eq(table.cardId, cardId)).run();
  } else if (was) db.update(table).set(next).where(eq(table.cardId, cardId)).run();
  else db.insert(table).values({ cardId, ...next }).run();
}
