import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cards } from './cards/cards';
import { projects } from './projects';

/** The work retrospective: friction noted on a card's run, per repository. */
export const friction = sqliteTable(
  'friction',
  {
    id: integer().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    repo: text().notNull(),
    cardId: text('card_id').notNull().references(() => cards.id),
    at: text().notNull(),
    what: text().notNull(),
    cost: text().notNull(),
    fix: text().notNull(),
  },
  (t) => [index('friction_repo').on(t.projectId, t.repo, t.at)],
);
