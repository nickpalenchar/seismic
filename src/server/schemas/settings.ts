import { and, eq } from 'drizzle-orm';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Db } from './common';
import { projects } from './projects';

/** A project's settings, a value by key. */
export const settings = sqliteTable(
  'settings',
  {
    projectId: text('project_id').notNull().references(() => projects.id),
    key: text().notNull(),
    value: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.key] })],
);

/** The project settings' queries (`Store.settings`). */
export class Settings {
  constructor(private readonly db: Db) {}

  get(projectId: string, key: string): string | null {
    return this.db.select({ value: settings.value }).from(settings).where(and(eq(settings.projectId, projectId), eq(settings.key, key))).get()?.value ?? null;
  }

  set(projectId: string, key: string, value: string) {
    this.db.insert(settings).values({ projectId, key, value }).onConflictDoUpdate({ target: [settings.projectId, settings.key], set: { value } }).run();
  }
}
