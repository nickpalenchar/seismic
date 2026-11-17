import { eq, sql } from 'drizzle-orm';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { WorkConfig } from '../../core/types';
import { cards } from './cards/cards';
import { type Db, now } from './common';

/** Each session that worked on a card, with the configuration it ran on (`WorkConfig`, null where unknown). */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    cardId: text('card_id').notNull().references(() => cards.id),
    sessionId: text('session_id').notNull(),
    harness: text(),
    model: text(),
    effort: text(),
    requested: text(),
    startedAt: text('started_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.sessionId] })],
);

/** The agent runs' queries (`Store.agentRuns`). */
export class AgentRuns {
  constructor(private readonly db: Db) {}

  /**
   * A session worked on the card with `config`: the first time it is heard, from `at`. Heard again
   * (a resume), it keeps what it ran on and only learns the model it resolved to, if that was unknown:
   * what it was started with is not known better later (a legacy session resumes on today's defaults).
   */
  record(cardId: string, session: string, config: WorkConfig, at: string = now()) {
    this.db
      .insert(agentRuns)
      .values({ cardId, sessionId: session, harness: config.harness, model: config.model, effort: config.effort, requested: config.requested ?? null, startedAt: at })
      .onConflictDoUpdate({ target: [agentRuns.cardId, agentRuns.sessionId], set: { model: sql`coalesce(${agentRuns.model}, excluded.model)` } })
      .run();
  }

  /** The sessions that worked on the card, the earliest first. */
  of(cardId: string): (WorkConfig & { session: string; at: string })[] {
    const rows = this.db
      .select({ session: agentRuns.sessionId, harness: agentRuns.harness, model: agentRuns.model, effort: agentRuns.effort, requested: agentRuns.requested, at: agentRuns.startedAt })
      .from(agentRuns)
      .where(eq(agentRuns.cardId, cardId))
      .orderBy(agentRuns.startedAt, sql`rowid`)
      .all() as (Omit<WorkConfig, 'requested'> & { requested: string | null; session: string; at: string })[];
    return rows.map(({ requested, ...r }) => ({ ...r, ...(requested ? { requested } : {}) }));
  }
}
