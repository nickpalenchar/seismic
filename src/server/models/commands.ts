import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from './projects';

/** A command the owner has the confirmation of, while it waits for "Undo": it outlives a restart. */
export const commands = sqliteTable('commands', {
  token: text().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  due: text().notNull(),
  body: text().notNull(),
});
