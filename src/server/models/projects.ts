import { eq } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { type Db, now } from './common';

/** A project: the repositories and cards the owner directs together; its name as last stored. */
export const projects = sqliteTable('projects', {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: text('created_at').notNull(),
});

/** The projects' queries (`Store.projects`). */
export class Projects {
  constructor(private readonly db: Db) {}

  /** A project's name as last stored; none for a project this database has never seen. */
  name(id: string): string | null {
    return this.db.select({ name: projects.name }).from(projects).where(eq(projects.id, id)).get()?.name ?? null;
  }

  /** The project is known by this name. */
  setName(id: string, name: string) {
    this.db.insert(projects).values({ id, name, createdAt: now() }).onConflictDoUpdate({ target: projects.id, set: { name } }).run();
  }
}
