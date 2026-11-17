import { and, eq, sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cards } from './cards/cards';
import type { Db } from './common';
import { projects } from './projects';

/** A clone of a repository a worker works in, and the card that has it leased. */
export const workstations = sqliteTable('workstations', {
  path: text().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  cardId: text('card_id').references(() => cards.id),
  repo: text(),
});

/** The workstations' queries (`Store.workstations`). */
export class Workstations {
  constructor(private readonly db: Db) {}

  add(projectId: string, path: string, repo: string | null = null) {
    this.db.insert(workstations).values({ path, projectId, repo }).onConflictDoNothing({ target: workstations.path }).run();
  }

  /** The workstations of one repository on the project (`null`: its home repository). */
  of(projectId: string, repo: string | null = null): { path: string; card_id: string | null }[] {
    return this.db
      .select({ path: workstations.path, card_id: workstations.cardId })
      .from(workstations)
      .where(and(eq(workstations.projectId, projectId), sql`${workstations.repo} IS ${repo ?? null}`))
      .orderBy(workstations.path)
      .all();
  }

  /** Whether a workstation is registered, on any project. */
  has(path: string): boolean {
    return !!this.db.select({ one: sql`1` }).from(workstations).where(eq(workstations.path, path)).get();
  }

  remove(path: string) {
    this.db.delete(workstations).where(eq(workstations.path, path)).run();
  }

  /** The card that has the workstation leased, or none. */
  lease(path: string, cardId: string | null) {
    this.db.update(workstations).set({ cardId }).where(eq(workstations.path, path)).run();
  }
}
