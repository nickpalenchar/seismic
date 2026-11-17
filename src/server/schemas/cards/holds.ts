import { eq, relations } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Hold, HoldReason } from '../../../core/types';
import type { Db } from '../common';
import { cards } from './cards';

/**
 * Why a card's agent does not run, or why the card is off the canvas (`Hold`): one reason at a
 * time, since when, and what that reason carries. A card has a row here while it is held.
 */
export const cardHolds = sqliteTable('card_holds', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id),
  reason: text().notNull().$type<HoldReason>(),
  since: text().notNull(),
  /** What the reason carries beside its time (a snooze's end, the messages held for the agent…), none where it carries nothing. */
  detail: text({ mode: 'json' }).$type<Record<string, unknown>>(),
});

export const cardHoldsRelations = relations(cardHolds, ({ one }) => ({ card: one(cards, { fields: [cardHolds.cardId], references: [cards.id] }) }));

/** The hold as its row has it, as `Hold`; none where there is no row. */
export function asHold(row: { reason: HoldReason; since: string; detail: Record<string, unknown> | null } | null | undefined): Hold | null {
  return row ? ({ reason: row.reason, since: row.since, ...row.detail } as Hold) : null;
}

/** The holds' queries (`Store.holds`); they are read with their cards (`Cards`). */
export class Holds {
  constructor(private readonly db: Db) {}

  /** Holds the card (a hold replaces the one before), or lets it go (`null`). */
  set(cardId: string, hold: Hold | null) {
    if (!hold) {
      this.db.delete(cardHolds).where(eq(cardHolds.cardId, cardId)).run();
      return;
    }
    const { reason, since, ...rest } = hold;
    const row = { reason, since, detail: Object.keys(rest).length ? (rest as Record<string, unknown>) : null };
    this.db.insert(cardHolds).values({ cardId, ...row }).onConflictDoUpdate({ target: cardHolds.cardId, set: row }).run();
  }
}
