import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { projects } from './projects';

/** A project holds its cards on canvases, each named once in it (case aside), in the project's order from 0. */
export const canvases = sqliteTable(
  'canvases',
  {
    id: text().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    name: text().notNull(),
    icon: text(),
    position: integer().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('canvases_name').on(t.projectId, sql`${t.name} COLLATE NOCASE`)],
);
