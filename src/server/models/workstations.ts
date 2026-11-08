import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cards } from './cards/cards';
import { projects } from './projects';

/** A clone of a repository a worker works in, and the card that has it leased. */
export const workstations = sqliteTable('workstations', {
  path: text().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  cardId: text('card_id').references(() => cards.id),
  repo: text(),
});
