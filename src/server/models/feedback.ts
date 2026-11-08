import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import type { Attribution, Feedback, FeedbackAnswer, WorkConfig } from '../../core/types';
import { cards } from './cards/cards';
import { type Db, now } from './common';
import { events } from './events';
import { projects } from './projects';

/** The owner's response on approved work, one per handover, with whom it credits as at that handover. */
export const feedback = sqliteTable(
  'feedback',
  {
    id: integer().primaryKey(),
    cardId: text('card_id').notNull().references(() => cards.id),
    projectId: text('project_id').notNull().references(() => projects.id),
    handover: integer().notNull(),
    context: text({ mode: 'json' }).notNull().$type<Pick<Feedback, 'title' | 'repo' | 'plan'>>(),
    attribution: text().notNull().$type<Attribution>(),
    configs: text({ mode: 'json' }).notNull().$type<WorkConfig[]>(),
    harness: text(),
    model: text(),
    effort: text(),
    answer: text({ mode: 'json' }).notNull().$type<FeedbackAnswer>(),
    facets: text({ mode: 'json' }).$type<Record<string, string>>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [unique().on(t.cardId, t.handover)],
);

const feedbackOf = (r: typeof feedback.$inferSelect & { short: string | null; deletedAt: string | null }): Feedback => ({
  id: r.id,
  cardId: r.cardId,
  ...(r.short ? { short: r.short } : {}),
  projectId: r.projectId,
  handover: r.handover,
  ...r.context,
  attribution: r.attribution,
  configs: r.configs,
  ...(r.attribution === 'single' && r.configs[0] ? { credited: r.configs[0] } : {}),
  answer: r.answer,
  ...(r.facets ? { facets: r.facets } : {}),
  at: r.createdAt,
  ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}),
  ...(r.deletedAt ? { deleted: true as const } : {}),
});

/** The owner's responses' queries (`Store.feedback`). */
export class Feedbacks {
  constructor(private readonly db: Db) {}

  /**
   * The owner's response on the card's `handover`: a new one, or the one given before for the same
   * handover with its answer and facets replaced. Whom it credits stays as it was first recorded.
   */
  put(f: Omit<Feedback, 'id' | 'at' | 'updatedAt' | 'cardId' | 'projectId' | 'short'> & { cardId: string; projectId: string }): Feedback {
    const credited = f.attribution === 'single' ? f.configs[0] : undefined;
    const context = { title: f.title, ...(f.repo ? { repo: f.repo } : {}), ...(f.plan ? { plan: f.plan } : {}) };
    const { id } = this.db
      .insert(feedback)
      .values({
        cardId: f.cardId,
        projectId: f.projectId,
        handover: f.handover,
        context,
        attribution: f.attribution,
        configs: f.configs,
        harness: credited?.harness ?? null,
        model: credited?.model ?? null,
        effort: credited?.effort ?? null,
        answer: f.answer,
        facets: f.facets ?? null,
        createdAt: now(),
      })
      .onConflictDoUpdate({
        target: [feedback.cardId, feedback.handover],
        set: {
          answer: sql`excluded.answer`,
          facets: sql`excluded.facets`,
          updatedAt: sql`CASE WHEN ${feedback.answer} IS excluded.answer AND ${feedback.facets} IS excluded.facets THEN ${feedback.updatedAt} ELSE excluded.created_at END`,
        },
      })
      .returning({ id: feedback.id })
      .get();
    return this.of({ id })[0]!;
  }

  /** For each of these cards that handed over work, its latest handover and the owner's answer on it, if one was given. */
  rated(cardIds: string[]): Map<string, { handover: number; answer?: FeedbackAnswer }> {
    if (!cardIds.length) return new Map();
    const latest = this.db
      .select({ cardId: events.cardId, handover: sql<number>`MAX(${events.id})`.as('latest_review') })
      .from(events)
      .where(and(eq(events.kind, 'review'), inArray(events.cardId, sql`(SELECT value FROM json_each(${JSON.stringify(cardIds)}))`)))
      .groupBy(events.cardId)
      .as('h');
    const rows = this.db
      .select({ cardId: latest.cardId, handover: latest.handover, answer: feedback.answer })
      .from(latest)
      .leftJoin(feedback, and(eq(feedback.cardId, latest.cardId), eq(feedback.handover, latest.handover)))
      .all();
    return new Map(rows.map((r) => [r.cardId, { handover: r.handover, ...(r.answer ? { answer: r.answer } : {}) }]));
  }

  /** The owner's responses, the earliest first: all of them, a card's, or one. */
  of(which: { cardId?: string; id?: number } = {}): Feedback[] {
    return this.db
      .select({ ...getTableColumns(feedback), short: cards.short, deletedAt: cards.deletedAt })
      .from(feedback)
      .innerJoin(cards, eq(cards.id, feedback.cardId))
      .where(and(which.cardId == null ? undefined : eq(feedback.cardId, which.cardId), which.id == null ? undefined : eq(feedback.id, which.id)))
      .orderBy(feedback.id)
      .all()
      .map(feedbackOf);
  }

  /** The card's responses go with it to another project. */
  setProject(cardId: string, projectId: string) {
    this.db.update(feedback).set({ projectId }).where(eq(feedback.cardId, cardId)).run();
  }
}
