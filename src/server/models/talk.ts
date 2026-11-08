import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Place } from '../../core/layout';
import type { AgentIdentity, AnswerFile, TalkAfter, TalkMoved, TalkRef } from '../../core/types';
import type { Wish } from '../../core/wish';
import type { HeldTalk, TalkWaitRow } from '../db';
import { cards } from './cards/cards';
import { chats } from './chats';
import { projects } from './projects';

/** What the owner said to the Koordinator and what it answered: its memory across sessions. */
export const talk = sqliteTable(
  'talk',
  {
    id: integer().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    at: text().notNull(),
    said: text().notNull(),
    reply: text().notNull(),
    cardId: text('card_id').references(() => cards.id),
    undone: integer({ mode: 'boolean' }).notNull().default(false),
    question: text(),
    about: text(),
    answer: text(),
    answerBy: text('answer_by').$type<'koordinator' | 'plan'>(),
    images: text({ mode: 'json' }).$type<string[]>(),
    unread: integer({ mode: 'boolean' }).notNull().default(false),
    sessionId: text('session_id'),
    thread: integer(),
    follows: integer(),
    files: text({ mode: 'json' }).$type<AnswerFile[]>(),
    card: text(),
    replyTo: text('reply_to', { mode: 'json' }).$type<TalkRef>(),
    wish: text({ mode: 'json' }).$type<Wish>(),
    held: text({ mode: 'json' }).$type<HeldTalk>(),
    waits: text({ mode: 'json' }).$type<TalkWaitRow[]>(),
    afterWait: text('after_wait', { mode: 'json' }).$type<TalkAfter>(),
    askedIn: text('asked_in'),
    moved: text({ mode: 'json' }).$type<TalkMoved>(),
    thenStep: text('then_step'),
    afterAnswer: integer('after_answer'),
    replyAgent: text('reply_agent', { mode: 'json' }).$type<AgentIdentity>(),
    answerAgent: text('answer_agent', { mode: 'json' }).$type<AgentIdentity>(),
    thenPlace: text('then_place', { mode: 'json' }).$type<Place>(),
    chat: integer().references(() => chats.id),
  },
  (t) => [index('talk_chat').on(t.chat, t.id)],
);
