import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cards } from './cards/cards';

/** Each session that worked on a card, with the configuration it ran on (`WorkConfig`, null where unknown). */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    cardId: text('card_id').notNull().references(() => cards.id),
    sessionId: text('session_id').notNull(),
    harness: text(),
    model: text(),
    effort: text(),
    requested: text(),
    startedAt: text('started_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.sessionId] })],
);
