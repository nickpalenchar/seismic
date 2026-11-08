import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ActivityCode, ActivityWho } from '../../core/types';
import { cards } from './cards/cards';

/** The Activity log: what happened on a card, by whom, with the card it waits for, the harness whose limit stopped it, or the title of a card it deleted. */
export const activity = sqliteTable(
  'activity',
  {
    id: integer().primaryKey(),
    at: text().notNull(),
    cardId: text('card_id').notNull().references(() => cards.id),
    who: text().notNull().$type<ActivityWho>(),
    code: text().notNull().$type<ActivityCode>(),
    otherId: text('other_id').references(() => cards.id),
    harness: text(),
    title: text(),
  },
  (t) => [index('activity_card').on(t.cardId, t.id)],
);
