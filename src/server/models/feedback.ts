import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import type { Attribution, Feedback, FeedbackAnswer, WorkConfig } from '../../core/types';
import { cards } from './cards/cards';
import { projects } from './projects';

/** The owner's response on approved work, one per handover, with whom it credits as at that handover. */
export const feedback = sqliteTable(
  'feedback',
  {
    id: integer().primaryKey(),
    cardId: text('card_id').notNull().references(() => cards.id),
    projectId: text('project_id').notNull().references(() => projects.id),
    handover: integer().notNull(),
    context: text({ mode: 'json' }).notNull().$type<Pick<Feedback, 'title' | 'repo' | 'plan'>>(),
    attribution: text().notNull().$type<Attribution>(),
    configs: text({ mode: 'json' }).notNull().$type<WorkConfig[]>(),
    harness: text(),
    model: text(),
    effort: text(),
    answer: text({ mode: 'json' }).notNull().$type<FeedbackAnswer>(),
    facets: text({ mode: 'json' }).$type<Record<string, string>>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [unique().on(t.cardId, t.handover)],
);
