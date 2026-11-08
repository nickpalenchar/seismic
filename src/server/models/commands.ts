import { eq } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Db } from './common';
import { projects } from './projects';

/** A command the owner has the confirmation of, while it waits for "Undo": it outlives a restart. */
export const commands = sqliteTable('commands', {
  token: text().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  due: text().notNull(),
  body: text().notNull(),
});

/** The held commands' queries (`Store.commands`). */
export class Commands {
  constructor(private readonly db: Db) {}

  /** A command that waits for "Undo" until `due`; `body` is what runs then, as JSON. */
  hold(projectId: string, token: string, due: string, body: string) {
    this.db.insert(commands).values({ token, projectId, due, body }).onConflictDoUpdate({ target: commands.token, set: { projectId, due, body } }).run();
  }

  drop(token: string) {
    this.db.delete(commands).where(eq(commands.token, token)).run();
  }

  /** The commands still waiting, oldest first: after a restart, those the stopped server held. */
  held(projectId: string): { token: string; due: string; body: string }[] {
    return this.db.select({ token: commands.token, due: commands.due, body: commands.body }).from(commands).where(eq(commands.projectId, projectId)).orderBy(commands.due).all();
  }
}
