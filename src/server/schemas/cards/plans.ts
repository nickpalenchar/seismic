import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PlanDoc } from '../../../core/plan-doc';
import type { StoredDeps } from '../../board';
import type { Db } from '../common';
import { cards } from './cards';
import { setPart } from './part';






export const cardPlans = sqliteTable(
  'card_plans',
  {
    cardId: text('card_id')
      .primaryKey()
      .references(() => cards.id),
    
    doc: text({ mode: 'json' }).$type<PlanDoc>(),
    
    deps: text({ mode: 'json' }).$type<StoredDeps>(),
    
    collapsed: integer({ mode: 'boolean' }).notNull().default(false),
    
    planDocs: text('plan_docs', { mode: 'json' }).$type<string[]>(),
  },
  (t) => [index('card_plans_plan_docs').on(t.cardId).where(sql`plan_docs IS NOT NULL`)],
);

export const cardPlansRelations = relations(cardPlans, ({ one }) => ({ card: one(cards, { fields: [cardPlans.cardId], references: [cards.id] }) }));


export type CardPlan = Omit<typeof cardPlans.$inferSelect, 'cardId'>;

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
