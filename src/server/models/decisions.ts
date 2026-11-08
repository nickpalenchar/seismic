import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cards } from './cards/cards';
import { projects } from './projects';

/** A question answered on a card, by the owner, its plan's agent or the Koordinator. */
export const decisions = sqliteTable('decisions', {
  id: integer().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  planId: text('plan_id').references(() => cards.id),
  cardId: text('card_id').notNull().references(() => cards.id),
  question: text().notNull(),
  answer: text().notNull(),
  by: text().notNull().$type<'owner' | 'plan' | 'koordinator'>(),
  at: text().notNull(),
});
