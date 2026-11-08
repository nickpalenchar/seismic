import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** A project: the repositories and cards the owner directs together; its name as last stored. */
export const projects = sqliteTable('projects', {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: text('created_at').notNull(),
});
