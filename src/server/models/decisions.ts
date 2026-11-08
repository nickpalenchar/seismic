import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cards } from './cards/cards';
import { type Db, now } from './common';
import { projects } from './projects';

/** A question answered on a card, by the owner, its plan's agent or the Koordinator. */
export const decisions = sqliteTable('decisions', {
  id: integer().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  planId: text('plan_id').references(() => cards.id),
  cardId: text('card_id').notNull().references(() => cards.id),
  question: text().notNull(),
  answer: text().notNull(),
  by: text().notNull().$type<'owner' | 'plan' | 'koordinator'>(),
  at: text().notNull(),
});

export type DecisionRow = typeof decisions.$inferSelect;

/** The decisions' queries (`Store.decisions`). */
export class Decisions {
  constructor(private readonly db: Db) {}

  add(d: Omit<DecisionRow, 'id' | 'at'>) {
    this.db.insert(decisions).values({ projectId: d.projectId, planId: d.planId, cardId: d.cardId, question: d.question, answer: d.answer, by: d.by, at: now() }).run();
  }

  /** The decisions taken on one card outside any plan (an idea's, say). */
  ofCard(projectId: string, cardId: string): DecisionRow[] {
    return this.db.select().from(decisions).where(and(eq(decisions.projectId, projectId), eq(decisions.cardId, cardId), isNull(decisions.planId))).orderBy(decisions.id).all();
  }

  /** A plan's decisions, or with `null` those of the project's standalone cards. */
  of(projectId: string, planId: string | null, limit = 40): DecisionRow[] {
    return this.db
      .select()
      .from(decisions)
      .where(and(eq(decisions.projectId, projectId), sql`${decisions.planId} IS ${planId ?? null}`))
      .orderBy(desc(decisions.id))
      .limit(limit)
      .all()
      .reverse();
  }

  /** The card's decisions go with it to another project. */
  setProject(cardId: string, projectId: string) {
    this.db.update(decisions).set({ projectId }).where(eq(decisions.cardId, cardId)).run();
  }
}
