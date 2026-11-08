import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PlanDoc } from '../../../core/plan-doc';
import type { StoredDeps } from '../../board';
import type { Db } from '../common';
import { cards } from './cards';
import { setPart } from './part';

/**
 * A card's plan part (`Item.plan`): a plan's doc as last read, which of its workstreams builds on
 * which, whether the owner folded it; and the plan docs the landed work of a card added. A card has
 * a row here once any of it is set, and none again once all of it is cleared.
 */
export const cardPlans = sqliteTable(
  'card_plans',
  {
    cardId: text('card_id')
      .primaryKey()
      .references(() => cards.id),
    /** Plans only: the plan doc as last read, kept for the archive once the doc is gone. */
    doc: text({ mode: 'json' }).$type<PlanDoc>(),
    /** Plans only: which workstream builds on which, as the Koordinator read it from the plan doc. */
    deps: text({ mode: 'json' }).$type<StoredDeps>(),
    /** While the owner has a plan folded to its head: its workstreams are not shown on the project. */
    collapsed: integer({ mode: 'boolean' }).notNull().default(false),
    /** The plan docs (plan references) the landed work of a card that was an idea added. */
    planDocs: text('plan_docs', { mode: 'json' }).$type<string[]>(),
  },
  (t) => [index('card_plans_plan_docs').on(t.cardId).where(sql`plan_docs IS NOT NULL`)],
);

export const cardPlansRelations = relations(cardPlans, ({ one }) => ({ card: one(cards, { fields: [cardPlans.cardId], references: [cards.id] }) }));

/** A card's plan part as read with it (`CardRow.plan`): JSON parsed, `collapsed` a boolean. */
export type CardPlan = Omit<typeof cardPlans.$inferSelect, 'cardId'>;
/** Fields of a card's plan part to set; `null` (or `false`) clears one. */
export type PlanUpdate = Partial<CardPlan>;

const EMPTY: CardPlan = { doc: null, deps: null, collapsed: false, planDocs: null };

/** The plan parts' queries (`Store.plans`); they are read with their cards (`Cards`). */
export class Plans {
  constructor(private readonly db: Db) {}

  /** Sets fields of the card's plan part: its row comes once any is set, and goes once none is. */
  set(cardId: string, fields: PlanUpdate) {
    setPart(this.db, cardPlans, EMPTY, cardId, fields);
  }
}
