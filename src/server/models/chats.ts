import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from './projects';

/** The owner's chats with Seismic on a project; new words go into the one opened last. */
export const chats = sqliteTable(
  'chats',
  {
    id: integer().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    at: text().notNull(),
    opened: text().notNull(),
    model: text(),
  },
  (t) => [index('chats_project').on(t.projectId, t.opened)],
);
