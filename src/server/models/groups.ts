import { and, asc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cards } from './cards/cards';
import { changes, type Db, now } from './common';
import { projects } from './projects';

/** A group of cards on a canvas, with its hue. */
export const groups = sqliteTable('groups', {
  id: text().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text().notNull(),
  hue: integer().notNull(),
  createdAt: text('created_at').notNull(),
  /** No foreign key, which would keep a canvas from ever being dropped: the store keeps it valid. */
  canvasId: text('canvas_id'),
});

export type GroupRow = typeof groups.$inferSelect & { canvasId: string };

/** The groups' queries (`Store.groups`). */
export class Groups {
  constructor(private readonly db: Db) {}

  /** The project's groups, the oldest first. */
  of(projectId: string): GroupRow[] {
    return this.db.select().from(groups).where(eq(groups.projectId, projectId)).orderBy(asc(groups.createdAt), sql`rowid`).all() as GroupRow[];
  }

  /** The groups on the canvas. */
  onCanvas(canvasId: string): GroupRow[] {
    return this.db.select().from(groups).where(eq(groups.canvasId, canvasId)).all() as GroupRow[];
  }

  get(id: string): GroupRow | null {
    return (this.db.select().from(groups).where(eq(groups.id, id)).get() as GroupRow | undefined) ?? null;
  }

  /** On canvas `into`, the oldest group named `name` (in any case). */
  named(into: string, name: string): string | null {
    return (
      this.db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.canvasId, into), sql`lower(${groups.name}) = lower(${name})`))
        .orderBy(asc(groups.createdAt), sql`rowid`)
        .limit(1)
        .get()?.id ?? null
    );
  }

  /** A new group on canvas `canvasId`. */
  add(projectId: string, name: string, hue: number, canvasId: string): GroupRow {
    const id = crypto.randomUUID();
    this.db.insert(groups).values({ id, projectId, canvasId, name, hue, createdAt: now() }).run();
    return this.get(id)!;
  }

  rename(id: string, name: string) {
    this.db.update(groups).set({ name }).where(eq(groups.id, id)).run();
  }

  /** The group goes. */
  delete(id: string) {
    this.db.delete(groups).where(eq(groups.id, id)).run();
  }

  /** Removes the project's groups no card belongs to, on the project or in the archive; returns how many. */
  dropEmpty(projectId: string): number {
    const held = this.db.select({ id: cards.groupId }).from(cards).where(and(eq(cards.projectId, projectId), isNotNull(cards.groupId)));
    return changes(this.db.delete(groups).where(and(eq(groups.projectId, projectId), notInArray(groups.id, held))).run());
  }

  /** The groups of canvas `from` go to canvas `into`. */
  moveCanvas(from: string, into: string) {
    this.db.update(groups).set({ canvasId: into }).where(eq(groups.canvasId, from)).run();
  }
}
