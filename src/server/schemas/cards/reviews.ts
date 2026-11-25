import { eq, relations } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PrState, StoredCodeReview, StoredContribution } from '../../board';
import type { ReviewItem, ReviewItemStatus, ReviewItemWho, Severity } from '../../../core/types';
import { atomic, type Db } from '../common';
import { cards } from './cards';
import { setPart } from './part';







export const cardReviews = sqliteTable('card_reviews', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id),
  
  pr: text({ mode: 'json' }).$type<PrState>(),
  
  contribution: text({ mode: 'json' }).$type<StoredContribution>(),
  
  codeReview: text('code_review', { mode: 'json' }).$type<StoredCodeReview>(),
});





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
    
    bundle: text({ mode: 'json' }).$type<number[]>(),
    status: text().notNull().$type<ReviewItemStatus>(),
    
    followUp: text('follow_up'),
    
    context: text(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.number] })],
);


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
    
    handover: integer(),
    
    run: text(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.number, t.position] }), index('card_review_item_events_card').on(t.cardId)],
);

export const cardReviewsRelations = relations(cardReviews, ({ one }) => ({ card: one(cards, { fields: [cardReviews.cardId], references: [cards.id] }) }));


export type CardReview = Omit<typeof cardReviews.$inferSelect, 'cardId'> & { items: ReviewItem[] };

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
