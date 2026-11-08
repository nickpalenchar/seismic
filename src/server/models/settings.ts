import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from './projects';

/** A project's settings, a value by key. */
export const settings = sqliteTable(
  'settings',
  {
    projectId: text('project_id').notNull().references(() => projects.id),
    key: text().notNull(),
    value: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.key] })],
);
