import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const seenHints = sqliteTable('seen_hints', {
  id: text().primaryKey(),
  seenAt: text('seen_at').notNull(),
});
