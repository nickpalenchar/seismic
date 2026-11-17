import { and, eq, gt, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cards } from './cards/cards';
import { atomic, type Db, now } from './common';
import { projects } from './projects';

/** The work retrospective: friction noted on a card's run, per repository. */
export const friction = sqliteTable(
  'friction',
  {
    id: integer().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    repo: text().notNull(),
    cardId: text('card_id').notNull().references(() => cards.id),
    at: text().notNull(),
    what: text().notNull(),
    cost: text().notNull(),
    fix: text().notNull(),
  },
  (t) => [index('friction_repo').on(t.projectId, t.repo, t.at)],
);

/** One piece of friction in a worker's run: what went wrong, what it cost, what would have prevented it. */
export interface FrictionNote {
  what: string;
  cost: string;
  fix: string;
}
export interface Friction extends FrictionNote {
  cardId: string;
  /** The card's title. */
  title: string;
  at: string;
}

/** The work retrospective's friction queries (`Store.friction`). */
export class Frictions {
  constructor(private readonly db: Db) {}

  add(projectId: string, repo: string, cardId: string, notes: FrictionNote[]) {
    const at = now();
    atomic(this.db, () => notes.forEach((n) => this.db.insert(friction).values({ projectId, repo, cardId, at, what: n.what, cost: n.cost, fix: n.fix }).run()));
  }

  /** The friction noted on a repository's cards after `since` (ISO time; all without), oldest first, with each card's title. */
  of(projectId: string, repo: string, since: string | null): Friction[] {
    return this.db
      .select({ cardId: friction.cardId, title: sql<string>`COALESCE(${cards.title}, '')`, at: friction.at, what: friction.what, cost: friction.cost, fix: friction.fix })
      .from(friction)
      .innerJoin(cards, eq(cards.id, friction.cardId))
      .where(and(eq(friction.projectId, projectId), eq(friction.repo, repo), gt(friction.at, since ?? '')))
      .orderBy(friction.at, friction.id)
      .all();
  }
}
