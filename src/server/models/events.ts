import { and, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { currentAgent } from '../agent-identity';
import type { AgentIdentity, AnswerRef, CardEvent, Mock, Spot } from '../../core/types';
import type { Wish } from '../../core/wish';
import { cards } from './cards/cards';
import { atomic, type Db, now } from './common';

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

const eventOf = ({ code, images, mocks, replyTo, spot, answer, picks, unread, readAfter, wish, reply, forwarded, agent, token, made, ...e }: typeof events.$inferSelect): CardEvent => ({
  ...e,
  ...(agent ? { agent } : {}),
  ...(code ? { code } : {}),
  ...(images ? { images } : {}),
  ...(mocks ? { mocks } : {}),
  ...(replyTo ? { replyTo } : {}),
  ...(spot ? { spot } : {}),
  ...(answer ? { answer } : {}),
  ...(picks ? { picks } : {}),
  ...(unread ? { unread: true as const } : {}),
  ...(readAfter ? { readAfter } : {}),
  ...(wish ? { wish } : {}),
  ...(reply ? { reply: true as const } : {}),
  ...(forwarded ? { forwarded: true as const } : {}),
  ...(token ? { token: true as const } : {}),
  ...(made ? { made } : {}),
});

/** The cards' history's queries (`Store.events`). */
export class Events {
  constructor(private readonly db: Db) {}

  /** A line in a card's log, said now or (`at`) earlier: a thread copied onto its Question card keeps its times. */
  add(e: Omit<CardEvent, 'id' | 'at'> & { at?: string }): CardEvent {
    const at = e.at ?? now();
    // An explicitly absent identity keeps copied historical messages unknown, even inside another agent's context.
    const agent = 'agent' in e ? e.agent : e.author !== 'owner' && e.author !== 'obeya' ? currentAgent() : undefined;
    const { id } = this.db
      .insert(events)
      .values({
        cardId: e.cardId,
        at,
        kind: e.kind,
        author: e.author,
        text: e.text,
        code: e.code ?? null,
        images: e.images?.length ? e.images : null,
        mocks: e.mocks?.length ? e.mocks : null,
        replyTo: e.replyTo ?? null,
        spot: e.spot ?? null,
        answer: e.answer ?? null,
        picks: e.picks?.length ? e.picks : null,
        unread: e.unread ? true : null,
        wish: e.wish ?? null,
        reply: e.reply ? true : null,
        forwarded: e.forwarded ? true : null,
        agent: agent ?? null,
        token: e.token ? true : null,
        made: e.made ?? null,
      })
      .returning({ id: events.id })
      .get();
    return { ...e, ...(agent ? { agent } : {}), id, at };
  }

  /** The latest messages of the card's conversation (`talk`, `question`), however many other lines came between them, oldest first. */
  talkOf(cardId: string, limit: number): CardEvent[] {
    const rows = this.db.select().from(events).where(and(eq(events.cardId, cardId), inArray(events.kind, ['talk', 'question']))).orderBy(desc(events.id)).limit(limit).all();
    return rows.reverse().map(eventOf);
  }

  /** The card's log, its latest `limit` lines, oldest first. */
  of(cardId: string, limit = 500): CardEvent[] {
    const rows = this.db.select().from(events).where(eq(events.cardId, cardId)).orderBy(desc(events.id)).limit(limit).all();
    return rows.reverse().map(eventOf);
  }

  /** One event of the card's log. */
  get(cardId: string, id: number): CardEvent | undefined {
    const row = this.db.select().from(events).where(and(eq(events.cardId, cardId), eq(events.id, id))).get();
    return row ? eventOf(row) : undefined;
  }

  /**
   * The agent read the owner's words of these events now: they are read, and those logged before
   * the card's latest line that was read stand after it (`readAfter`). Returns those that were unread, as they are now.
   */
  read(cardId: string, ids: number[]): CardEvent[] {
    return atomic(this.db, () => {
      ids = ids.filter((id) => this.get(cardId, id)?.unread);
      if (!ids.length) return [];
      const last = this.db.select({ last: max(events.id) }).from(events).where(and(eq(events.cardId, cardId), isNull(events.unread))).get()?.last ?? null;
      for (const id of ids)
        this.db
          .update(events)
          .set({ unread: null, readAfter: sql`CASE WHEN ${last} > ${events.id} THEN ${last} END` })
          .where(and(eq(events.cardId, cardId), eq(events.id, id), eq(events.unread, true)))
          .run();
      return ids.map((id) => this.get(cardId, id)).filter((e) => !!e);
    });
  }

  /** Takes an event out of the card's log. */
  delete(cardId: string, id: number) {
    this.db.delete(events).where(and(eq(events.cardId, cardId), eq(events.id, id))).run();
  }

  /** The last line of the card's log that names a branch of its own (`obeya/<slug>-<id>…`). */
  branchMention(cardId: string): string | null {
    const row = this.db
      .select({ text: events.text })
      .from(events)
      .where(and(eq(events.cardId, cardId), sql`${events.text} LIKE '%obeya/%' || ${cardId.slice(0, 6)} || '%'`))
      .orderBy(desc(events.id))
      .limit(1)
      .get();
    return row?.text ?? null;
  }

  /** The card's handover (its `review` event) with the id `id`, or its latest. */
  handover(cardId: string, id?: number): { id: number; at: string } | undefined {
    return this.db
      .select({ id: events.id, at: events.at })
      .from(events)
      .where(and(eq(events.cardId, cardId), eq(events.kind, 'review'), id == null ? undefined : eq(events.id, id)))
      .orderBy(desc(events.id))
      .limit(1)
      .get();
  }
}
