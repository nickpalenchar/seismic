import { relations } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PrState, StoredCodeReview, StoredContribution } from '../../board';
import type { Db } from '../common';
import { cards } from './cards';
import { setPart } from './part';

/**
 * A card's review part (`Item.review`): the pull request its work goes out as or that it reviews,
 * a contributor's pull request it reviews, and the code review of its work. A card has a row here
 * once any of it is set, and none again once all of it is cleared.
 */
export const cardReviews = sqliteTable('card_reviews', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id),
  /** The card's pull request once approval opened the PR phase; on a review card, the one it reviews from the start. */
  pr: text({ mode: 'json' }).$type<PrState>(),
  /** Review cards only: the contributor's pull request the card reviews. */
  contribution: text({ mode: 'json' }).$type<StoredContribution>(),
  /** The code review of the card's work, where its project reviews work that lands on main. */
  codeReview: text('code_review', { mode: 'json' }).$type<StoredCodeReview>(),
});

export const cardReviewsRelations = relations(cardReviews, ({ one }) => ({ card: one(cards, { fields: [cardReviews.cardId], references: [cards.id] }) }));

/** A card's review part as read with it (`CardRow.review`), JSON parsed. */
export type CardReview = Omit<typeof cardReviews.$inferSelect, 'cardId'>;
/** Fields of a card's review part to set; `null` clears one. */
export type ReviewUpdate = Partial<CardReview>;

const EMPTY: CardReview = { pr: null, contribution: null, codeReview: null };

/** The review parts' queries (`Store.reviews`); they are read with their cards (`Cards`). */
export class Reviews {
  constructor(private readonly db: Db) {}

  /** Sets fields of the card's review part: its row comes once any is set, and goes once none is. */
  set(cardId: string, fields: ReviewUpdate) {
    setPart(this.db, cardReviews, EMPTY, cardId, fields);
  }
}
