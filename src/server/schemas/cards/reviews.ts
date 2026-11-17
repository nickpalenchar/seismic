import { eq, relations } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PrState, StoredCodeReview, StoredContribution } from '../../board';
import type { ReviewItem, ReviewItemStatus, ReviewItemWho, Severity } from '../../../core/types';
import { atomic, type Db } from '../common';
import { cards } from './cards';
import { setPart } from './part';

/**
 * A card's review part (`Item.review`): the pull request its work goes out as or that it reviews,
 * a contributor's pull request it reviews, and the code review of its work (its runs; the items
 * they raised are rows of `cardReviewItems`). A card has a row here once any of it is set, and none
 * again once all of it is cleared.
 */
export const cardReviews = sqliteTable('card_reviews', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id),
  /** The card's pull request once approval opened the PR phase; on a review card, the one it reviews from the start. */
  pr: text({ mode: 'json' }).$type<PrState>(),
  /** Review cards only: the contributor's pull request the card reviews. */
  contribution: text({ mode: 'json' }).$type<StoredContribution>(),
  /** The code review of the card's work, where its project reviews work that lands on main: its mode, its handover and its latest run's metadata. */
  codeReview: text('code_review', { mode: 'json' }).$type<StoredCodeReview>(),
});

/**
 * The one running list of a card's code review: an item per row, numbered per card across all review
 * runs, with its status, the follow-up task made of it and what the owner wrote on it.
 */
export const cardReviewItems = sqliteTable(
  'card_review_items',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
    number: integer().notNull(),
    title: text().notNull(),
    text: text().notNull(),
    severity: text().notNull().$type<Severity>(),
    file: text(),
    line: integer(),
    security: integer({ mode: 'boolean' }).notNull().default(false),
    /** The numbers of the other items fixed, or made one follow-up task, with it. */
    bundle: text({ mode: 'json' }).$type<number[]>(),
    status: text().notNull().$type<ReviewItemStatus>(),
    /** The follow-up task the worker made of it. */
    followUp: text('follow_up'),
    /** What the owner wrote on it. */
    context: text(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.number] })],
);

/** Every status change of a review item, in order (`position`, the oldest is 0). */
export const cardReviewItemEvents = sqliteTable(
  'card_review_item_events',
  {
    cardId: text('card_id').notNull(),
    number: integer().notNull(),
    position: integer().notNull(),
    at: text().notNull(),
    who: text().notNull().$type<ReviewItemWho>(),
    from: text().$type<ReviewItemStatus>(),
    to: text().notNull().$type<ReviewItemStatus>(),
    note: text(),
    /** The handover (its event) the change came with. */
    handover: integer(),
    /** The review run (its start time) the change came with. */
    run: text(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.number, t.position] }), index('card_review_item_events_card').on(t.cardId)],
);

export const cardReviewsRelations = relations(cardReviews, ({ one }) => ({ card: one(cards, { fields: [cardReviews.cardId], references: [cards.id] }) }));

/** A card's review part as read with it (`CardRow.review`), JSON parsed, with the items of its code review. */
export type CardReview = Omit<typeof cardReviews.$inferSelect, 'cardId'> & { items: ReviewItem[] };
/** Fields of a card's review part to set; `null` clears one, `items` replaces the whole list. */
export type ReviewUpdate = Partial<CardReview>;

const EMPTY: Omit<CardReview, 'items'> = { pr: null, contribution: null, codeReview: null };

type ItemRow = typeof cardReviewItems.$inferSelect;
type EventRow = typeof cardReviewItemEvents.$inferSelect;

/** The review part of a card as read: its row of `cardReviews` and its items with their logs, or none where it has none. */
export function asReview(own: (Omit<CardReview, 'items'> & { cardId?: string }) | null | undefined, items: ItemRow[], events: EventRow[]): CardReview | null {
  if (!own && !items.length) return null;
  const { cardId: _, ...fields } = own ?? ({} as { cardId?: string });
  const log = new Map<number, EventRow[]>();
  for (const e of events) (log.get(e.number) ?? log.set(e.number, []).get(e.number)!).push(e);
  return {
    ...EMPTY,
    ...fields,
    items: items
      .sort((a, b) => a.number - b.number)
      .map((r): ReviewItem => ({
        number: r.number,
        title: r.title,
        text: r.text,
        severity: r.severity,
        ...(r.security ? { security: true } : {}),
        ...(r.file ? { file: r.file } : {}),
        ...(r.file && r.line ? { line: r.line } : {}),
        ...(r.bundle?.length ? { with: r.bundle } : {}),
        status: r.status,
        ...(r.followUp ? { card: r.followUp } : {}),
        ...(r.context ? { context: r.context } : {}),
        log: (log.get(r.number) ?? [])
          .sort((a, b) => a.position - b.position)
          .map((e) => ({ at: e.at, who: e.who, ...(e.from ? { from: e.from } : {}), to: e.to, ...(e.note ? { note: e.note } : {}), ...(e.handover !== null ? { handover: e.handover } : {}), ...(e.run ? { run: e.run } : {}) })),
      })),
  };
}

/** The review parts' queries (`Store.reviews`); they are read with their cards (`Cards`). */
export class Reviews {
  constructor(private readonly db: Db) {}

  /** Sets fields of the card's review part: its row comes once any is set or it has items, and goes once neither holds; `items` replaces the list. */
  set(cardId: string, { items, ...fields }: ReviewUpdate) {
    if (!items && !Object.keys(fields).length) return;
    atomic(this.db, () => {
      if (items) {
        this.db.delete(cardReviewItemEvents).where(eq(cardReviewItemEvents.cardId, cardId)).run();
        this.db.delete(cardReviewItems).where(eq(cardReviewItems.cardId, cardId)).run();
        for (const i of items) {
          this.db
            .insert(cardReviewItems)
            .values({
              cardId,
              number: i.number,
              title: i.title,
              text: i.text,
              severity: i.severity,
              file: i.file ?? null,
              line: i.line ?? null,
              security: !!i.security,
              bundle: i.with?.length ? i.with : null,
              status: i.status,
              followUp: i.card ?? null,
              context: i.context ?? null,
            })
            .run();
          if (i.log.length)
            this.db
              .insert(cardReviewItemEvents)
              .values(i.log.map((e, position) => ({ cardId, number: i.number, position, at: e.at, who: e.who, from: e.from ?? null, to: e.to, note: e.note ?? null, handover: e.handover ?? null, run: e.run ?? null })))
              .run();
        }
      }
      const more = items ? items.length > 0 : !!this.db.select({ n: cardReviewItems.number }).from(cardReviewItems).where(eq(cardReviewItems.cardId, cardId)).limit(1).get();
      setPart(this.db, cardReviews, EMPTY, cardId, fields, more);
    });
  }
}
