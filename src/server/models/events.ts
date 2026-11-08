import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { AgentIdentity, AnswerRef, CardEvent, Mock, Spot } from '../../core/types';
import type { Wish } from '../../core/wish';
import { cards } from './cards/cards';

/** A card's history: its conversation and what happened to it (`CardEvent`). */
export const events = sqliteTable(
  'events',
  {
    id: integer().primaryKey(),
    cardId: text('card_id').notNull().references(() => cards.id),
    at: text().notNull(),
    kind: text().notNull().$type<CardEvent['kind']>(),
    author: text().notNull().$type<CardEvent['author']>(),
    text: text().notNull(),
    code: text().$type<NonNullable<CardEvent['code']>>(),
    images: text({ mode: 'json' }).$type<string[]>(),
    mocks: text({ mode: 'json' }).$type<Mock[]>(),
    replyTo: integer('reply_to'),
    spot: text({ mode: 'json' }).$type<Spot>(),
    answer: text({ mode: 'json' }).$type<AnswerRef>(),
    picks: text({ mode: 'json' }).$type<string[]>(),
    unread: integer({ mode: 'boolean' }),
    readAfter: integer('read_after'),
    wish: text({ mode: 'json' }).$type<Wish>(),
    reply: integer({ mode: 'boolean' }),
    forwarded: integer({ mode: 'boolean' }),
    agent: text({ mode: 'json' }).$type<AgentIdentity>(),
    token: integer({ mode: 'boolean' }),
    made: text({ mode: 'json' }).$type<NonNullable<CardEvent['made']>>(),
  },
  (t) => [index('events_card').on(t.cardId, t.id)],
);
