import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { alias, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { currentAgent } from '../agent-identity';
import type { Place } from '../../core/layout';
import type { AgentIdentity, AnswerFile, Talk as TalkView, TalkAfter, TalkMoved, TalkQuote, TalkRef, TalkWait } from '../../core/types';
import type { Wish } from '../../core/wish';
import { cards } from './cards/cards';
import { chats } from './chats';
import { changes, type Db, now } from './common';
import { projects } from './projects';

/** Words the usage limit keeps the Koordinator from reading (`talk.held`): until when, and how it reads them then (`Commander`'s). */
export interface HeldTalk {
  until: string;
  reading: unknown;
}

/** A card the Koordinator waits on (`talk.waits`), and the step it said it takes once the card gets there. */
export interface TalkWaitRow extends TalkWait {
  then: string;
}

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

type TalkRecord = typeof talk.$inferSelect;

const toTalk = (r: TalkRecord): TalkView => ({
  id: r.id,
  at: r.at,
  said: r.said,
  ...(r.replyAgent ? { replyAgent: r.replyAgent } : {}),
  ...(r.answerAgent ? { answerAgent: r.answerAgent } : {}),
  // empty while the Koordinator reads the words
  ...(r.reply ? { reply: r.reply } : {}),
  ...(r.cardId ? { cardId: r.cardId } : {}),
  ...(r.undone ? { undone: true } : {}),
  ...(r.question ? { question: r.question } : {}),
  ...(r.answer !== null ? { answer: r.answer } : {}),
  ...(r.answerBy ? { answerBy: r.answerBy } : {}),
  ...(r.unread ? { unread: true as const } : {}),
  ...(r.images ? { images: r.images } : {}),
  // a looked-up question is a thread of its own until it follows up on one
  ...(r.question ? { thread: r.thread ?? r.id } : {}),
  ...(r.follows ? { follows: r.follows } : {}),
  ...(r.files ? { files: r.files } : {}),
  ...(r.card ? { movedTo: r.card } : {}),
  ...(r.wish ? { wish: r.wish } : {}),
  ...(r.held ? { heldUntil: r.held.until } : {}),
  ...(r.waits ? { waits: r.waits.map(({ card, title, state }) => ({ card, title, state })) } : {}),
  ...(r.afterWait ? { after: r.afterWait } : {}),
  ...(r.askedIn ? { askedIn: r.askedIn } : {}),
  ...(r.moved ? { moved: r.moved } : {}),
  ...(r.thenStep ? { then: r.thenStep } : {}),
  ...(r.afterAnswer ? { answered: r.afterAnswer } : {}),
  ...(r.chat ? { chat: r.chat } : {}),
});

/** The exchange a thread's exchange belongs to: the one that started its thread. */
const root = alias(talk, 'r');

/** The Koordinator's memory's queries (`Store.talk`). */
export class Talk {
  constructor(private readonly db: Db) {}

  /** An exchange in chat `chat`; the Koordinator takes up one by itself after waiting on a card (`after`) or once a looked-up answer is in (`answered`). */
  add(projectId: string, chat: number, said: string, reply: string, cardId: string | null, lookUp?: { question: string; about: string | null }, images: string[] = [], replyTo?: TalkRef, after?: TalkAfter, askedIn?: string, answered?: number): number {
    return this.db
      .insert(talk)
      .values({
        projectId,
        chat,
        at: now(),
        said,
        reply,
        cardId,
        question: lookUp?.question ?? null,
        about: lookUp?.about ?? null,
        images: images.length ? images : null,
        replyTo: replyTo ? { talk: replyTo.talk, part: replyTo.part } : null,
        afterWait: after ?? null,
        askedIn: askedIn ?? null,
        afterAnswer: answered ?? null,
      })
      .returning({ id: talk.id })
      .get().id;
  }

  /** An exchange of no one's in chat `chat` of the project's sheet, `reply` saying the card moved to another project. */
  addMoved(projectId: string, chat: number, moved: TalkMoved, reply: string): number {
    return this.db.insert(talk).values({ projectId, at: now(), said: '', reply, moved, chat }).returning({ id: talk.id }).get().id;
  }

  /** The chat exchange `id` was said in, if it was in one. */
  chatOf(id: number): number | undefined {
    return this.db.select({ chat: talk.chat }).from(talk).where(eq(talk.id, id)).get()?.chat ?? undefined;
  }

  /**
   * The Koordinator's reply to words it has read, the question it looks up for them, and what a draft
   * for Seismic's makers would start from; with `waits`, one for the sheet waits there unread, as an
   * answer that was looked up does.
   */
  reply(id: number, reply: string, lookUp?: { question: string; about: string | null }, wish?: Wish, waits = false, agent?: AgentIdentity) {
    if (arguments.length < 6) agent = currentAgent();
    this.db
      .update(talk)
      .set({
        reply,
        replyAgent: agent ?? null,
        question: lookUp?.question ?? null,
        about: lookUp?.about ?? null,
        wish: wish ?? null,
        unread: sql`${waits ? 1 : 0} AND ${talk.cardId} IS NULL AND ${talk.card} IS NULL`,
      })
      .where(eq(talk.id, id))
      .run();
  }

  /**
   * Words the Koordinator was reading when Seismic stopped: they get `reply`; returns them. Words the
   * usage limit holds wait on; words asked in a plan's sheet the Koordinator never reads.
   */
  interrupt(projectId: string, reply: string): TalkView[] {
    const reading = and(eq(talk.projectId, projectId), eq(talk.reply, ''), isNull(talk.held), isNull(talk.askedIn));
    const rows = this.db.select().from(talk).where(reading).orderBy(talk.id).all();
    this.db.update(talk).set({ reply }).where(reading).run();
    return rows.map(toTalk);
  }

  /** Words the usage limit keeps the Koordinator from reading until `held.until`; `null` once it reads them. */
  hold(id: number, held: HeldTalk | null) {
    this.db.update(talk).set({ held }).where(eq(talk.id, id)).run();
  }

  /** The words the usage limit holds, oldest first. */
  held(projectId: string): (TalkView & { held: HeldTalk })[] {
    return this.db
      .select()
      .from(talk)
      .where(and(eq(talk.projectId, projectId), isNotNull(talk.held)))
      .orderBy(talk.id)
      .all()
      .map((r) => ({ ...toTalk(r), held: r.held! }));
  }

  /** The cards the Koordinator waits on after the exchange's reply; none once it no longer waits on any. */
  wait(id: number, waits: TalkWaitRow[]) {
    this.db.update(talk).set({ waits: waits.length ? waits : null }).where(eq(talk.id, id)).run();
  }

  /** The exchanges whose reply said the Koordinator waits on a card, oldest first. */
  waiting(projectId: string): (TalkView & { waiting: TalkWaitRow[] })[] {
    return this.db
      .select()
      .from(talk)
      .where(and(eq(talk.projectId, projectId), isNotNull(talk.waits)))
      .orderBy(talk.id)
      .all()
      .map((r) => ({ ...toTalk(r), waiting: r.waits! }));
  }

  /**
   * The step the Koordinator takes once the exchange's looked-up answer is in, and where the owner
   * was on the project when they asked for it; `null` once it has decided it.
   */
  thenStep(id: number, then: string | null, place?: Place) {
    this.db
      .update(talk)
      .set({ thenStep: then, thenPlace: then !== null && place ? place : null })
      .where(eq(talk.id, id))
      .run();
  }

  /** Looked-up answers that are in, oldest first, whose step the Koordinator has not decided yet. */
  answeredSteps(projectId: string): TalkView[] {
    return this.db
      .select()
      .from(talk)
      .where(and(eq(talk.projectId, projectId), isNotNull(talk.thenStep), isNotNull(talk.answer)))
      .orderBy(talk.id)
      .all()
      .map(toTalk);
  }

  undo(id: number) {
    this.db.update(talk).set({ undone: true }).where(eq(talk.id, id)).run();
  }

  /**
   * The answer to a looked-up question, with its files; one for the sheet (no card was open, and its
   * thread is on no Question card) waits there unread.
   */
  answer(id: number, answer: string, by: 'koordinator' | 'plan', files: AnswerFile[] = [], agent?: AgentIdentity) {
    if (arguments.length < 5) agent = currentAgent();
    this.db
      .update(talk)
      .set({ answer, answerAgent: agent ?? null, answerBy: by, files: files.length ? files : null, unread: sql`${talk.cardId} IS NULL AND ${talk.card} IS NULL` })
      .where(eq(talk.id, id))
      .run();
  }

  /** A follow-up continues the answer `follows`, in the thread `thread`. */
  follow(id: number, thread: number, follows: number) {
    this.db.update(talk).set({ thread, follows }).where(eq(talk.id, id)).run();
  }

  /** The session of the agent that looks the exchange's question up. */
  session(id: number, session: string) {
    this.db.update(talk).set({ sessionId: session }).where(eq(talk.id, id)).run();
  }

  /** The exchanges of a thread, oldest first, with the session each was looked up in. */
  thread(projectId: string, thread: number): (TalkView & { about?: string; session?: string })[] {
    return this.db
      .select()
      .from(talk)
      .where(and(eq(talk.projectId, projectId), sql`(${talk.id} = ${thread} OR ${talk.thread} = ${thread})`))
      .orderBy(talk.id)
      .all()
      .map((r) => ({ ...this.withContinues(r), ...(r.about ? { about: r.about } : {}), ...(r.sessionId ? { session: r.sessionId } : {}) }));
  }

  /** The thread moved onto a Question card: its exchanges, and every follow-up asked later, are answered there. */
  moveThread(projectId: string, thread: number, card: string) {
    this.db
      .update(talk)
      .set({ card, unread: false })
      .where(and(eq(talk.projectId, projectId), sql`(${talk.id} = ${thread} OR ${talk.thread} = ${thread})`))
      .run();
  }

  /** The owner saw the answers of chat `chat`, or (`ids`) those of a plan's sheet; whether any was unread. */
  read(projectId: string, which: { chat: number } | { ids: number[] }): boolean {
    const of = 'ids' in which ? inArray(talk.id, sql`(SELECT value FROM json_each(${JSON.stringify(which.ids)}))`) : eq(talk.chat, which.chat);
    return changes(this.db.update(talk).set({ unread: false }).where(and(eq(talk.projectId, projectId), eq(talk.unread, true), of)).run()) > 0;
  }

  /**
   * The latest exchanges of the threads about any of `about` (a plan and its workstreams), oldest
   * first: those its plan agent answers.
   */
  about(projectId: string, about: string[], limit = 100): TalkView[] {
    return this.db
      .select(getTableColumns(talk))
      .from(talk)
      .innerJoin(root, eq(root.id, sql`COALESCE(${talk.thread}, ${talk.id})`))
      .where(and(eq(talk.projectId, projectId), inArray(root.about, sql`(SELECT value FROM json_each(${JSON.stringify(about)}))`)))
      .orderBy(desc(talk.id))
      .limit(limit)
      .all()
      .reverse()
      .map((r) => this.withContinues(r));
  }

  /** The latest exchanges, oldest first; with `withoutCard`, only those without an open card; with `chat`, only that chat's. */
  latest(projectId: string, limit = 20, withoutCard = false, chat?: number): TalkView[] {
    return this.db
      .select()
      .from(talk)
      .where(and(eq(talk.projectId, projectId), withoutCard ? isNull(talk.cardId) : undefined, chat !== undefined ? eq(talk.chat, chat) : undefined))
      .orderBy(desc(talk.id))
      .limit(limit)
      .all()
      .reverse()
      .map((r) => this.withContinues(r));
  }

  /** What Seismic's sheet shows: the latest exchanges of chat `chat` without an open card, and the answers that wait unread in the project's other chats; oldest first. */
  sheet(projectId: string, chat: number, limit: number): TalkView[] {
    const elsewhere = this.db
      .select()
      .from(talk)
      .where(and(eq(talk.projectId, projectId), eq(talk.unread, true), ne(talk.chat, chat)))
      .orderBy(talk.id)
      .all();
    const here = this.latest(projectId, limit, true, chat);
    return elsewhere.length ? [...elsewhere.map((r) => this.withContinues(r)), ...here].sort((a, b) => a.id - b.id) : here;
  }

  /** A message of the project's sheet (an exchange with no card open), as a reply quotes it. */
  sheetQuote(projectId: string, ref: TalkRef): TalkQuote | undefined {
    const sheet = this.db
      .select({ one: sql`1` })
      .from(talk)
      .where(and(eq(talk.id, ref.talk), eq(talk.projectId, projectId), isNull(talk.cardId)))
      .get();
    return sheet ? this.quoted(ref) : undefined;
  }

  /** One exchange, with the card its question is about. */
  exchange(id: number): (TalkView & { about?: string; thenPlace?: Place }) | null {
    const r = this.db.select().from(talk).where(eq(talk.id, id)).get();
    return r ? { ...this.withContinues(r), ...(r.about ? { about: r.about } : {}), ...(r.thenPlace ? { thenPlace: r.thenPlace } : {}) } : null;
  }

  /** Questions being looked up, oldest first. */
  lookingUp(projectId: string): number[] {
    return this.db
      .select({ id: talk.id })
      .from(talk)
      .where(and(eq(talk.projectId, projectId), isNotNull(talk.question), isNull(talk.answer)))
      .orderBy(asc(talk.id))
      .all()
      .map((r) => r.id);
  }

  /**
   * An exchange with the question of the answer it continues, when it follows up on one, and the
   * message of the sheet it replies to, when it does.
   */
  private withContinues(r: TalkRecord): TalkView {
    const followed = r.follows ? this.db.select({ question: talk.question }).from(talk).where(eq(talk.id, r.follows)).get() : null;
    const replyTo = r.replyTo ? this.quoted(r.replyTo) : undefined;
    return { ...toTalk(r), ...(followed?.question ? { continues: followed.question } : {}), ...(replyTo ? { replyTo } : {}) };
  }

  /** A message of the sheet as a reply quotes it; none where the exchange or its part is gone. */
  private quoted(ref: TalkRef): TalkQuote | undefined {
    const r = this.db.select({ said: talk.said, reply: talk.reply, answer: talk.answer, answerBy: talk.answerBy }).from(talk).where(eq(talk.id, ref.talk)).get();
    const text = r?.[ref.part];
    if (!r || !text) return;
    return { talk: ref.talk, part: ref.part, by: ref.part === 'said' ? 'owner' : ref.part === 'answer' ? (r.answerBy ?? 'koordinator') : 'koordinator', text };
  }
}
