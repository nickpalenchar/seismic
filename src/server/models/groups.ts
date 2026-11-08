import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from './projects';

/** A group of cards on a canvas, with its hue. */
export const groups = sqliteTable('groups', {
  id: text().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text().notNull(),
  hue: integer().notNull(),
  createdAt: text('created_at').notNull(),
  /** No foreign key, which would keep a canvas from ever being dropped: the store keeps it valid. */
  canvasId: text('canvas_id'),
});
