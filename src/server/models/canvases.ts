import { and, eq, sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { MAIN_CANVAS } from '../../core/types';
import { atomic, type Db, now } from './common';
import { projects } from './projects';

/** A project holds its cards on canvases, each named once in it (case aside), in the project's order from 0. */
export const canvases = sqliteTable(
  'canvases',
  {
    id: text().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    name: text().notNull(),
    icon: text(),
    position: integer().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('canvases_name').on(t.projectId, sql`${t.name} COLLATE NOCASE`)],
);

export type CanvasRow = typeof canvases.$inferSelect;

/** The canvases' queries (`Store.canvases`). */
export class Canvases {
  constructor(private readonly db: Db) {}

  /** The project's canvases in the owner's order. */
  of(projectId: string): CanvasRow[] {
    return this.db.select().from(canvases).where(eq(canvases.projectId, projectId)).orderBy(canvases.position, sql`rowid`).all();
  }

  get(id: string): CanvasRow | null {
    return this.db.select().from(canvases).where(eq(canvases.id, id)).get() ?? null;
  }

  /** The id of the project's canvas `main`, which every project has from `Store.ensureProject` on (or from here, for a project stored without it). */
  main(projectId: string): string {
    const row = this.db.select({ id: canvases.id }).from(canvases).where(and(eq(canvases.projectId, projectId), eq(canvases.name, MAIN_CANVAS))).get();
    return row?.id ?? this.insert(projectId, MAIN_CANVAS, null);
  }

  /** Whether the project has a canvas. */
  any(projectId: string): boolean {
    return !!this.db.select({ one: sql`1` }).from(canvases).where(eq(canvases.projectId, projectId)).get();
  }

  /** A new canvas, last in the project's order. */
  add(projectId: string, name: string, icon: string | null): CanvasRow {
    return this.get(this.insert(projectId, name, icon))!;
  }

  private insert(projectId: string, name: string, icon: string | null): string {
    const id = crypto.randomUUID();
    const position = sql<number>`(SELECT COALESCE(MAX(position) + 1, 0) FROM canvases WHERE project_id = ${projectId})`;
    this.db.insert(canvases).values({ id, projectId, name, icon, position, createdAt: now() }).run();
    return id;
  }

  update(id: string, fields: Partial<Pick<CanvasRow, 'name' | 'icon'>>) {
    if (!Object.keys(fields).length) return;
    this.db.update(canvases).set(fields).where(eq(canvases.id, id)).run();
  }

  /** The project's canvases take this order (their ids, all of them). */
  order(ids: string[]) {
    atomic(this.db, () => ids.forEach((id, position) => this.db.update(canvases).set({ position }).where(eq(canvases.id, id)).run()));
  }

  /** The canvas goes. */
  delete(id: string) {
    this.db.delete(canvases).where(eq(canvases.id, id)).run();
  }
}
