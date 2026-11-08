import { type AnySQLiteColumn, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PreferenceState } from '../../core/types';
import { cards } from './cards/cards';
import { projects } from './projects';

/** The owner's standing preferences on a project, proposed, in force or set aside. */
export const preferences = sqliteTable('preferences', {
  id: integer().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  text: text().notNull(),
  cardId: text('card_id').references(() => cards.id),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at'),
  state: text().notNull().default('active').$type<PreferenceState>(),
  quote: text(),
  review: integer({ mode: 'boolean' }).notNull().default(false),
  replaces: integer().references((): AnySQLiteColumn => preferences.id),
  decidedAt: text('decided_at'),
  target: text(),
});
