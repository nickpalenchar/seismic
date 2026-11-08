import { and, desc, eq, max, ne, notExists, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { AgentModel, Chat } from '../../core/types';
import { atomic, type Db, now } from './common';
import { projects } from './projects';
import { talk } from './talk';

/** The owner's chats with Seismic on a project; new words go into the one opened last. */
export const chats = sqliteTable(
  'chats',
  {
    id: integer().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    at: text().notNull(),
    opened: text().notNull(),
    model: text(),
  },
  (t) => [index('chats_project').on(t.projectId, t.opened)],
);

/** The chats' queries (`Store.chats`). */
export class Chats {
  constructor(private readonly db: Db) {}

  /** The chat new words on the project go into: the one the owner opened last; a first one where there is none. */
  current(projectId: string): number {
    const r = this.db.select({ id: chats.id }).from(chats).where(eq(chats.projectId, projectId)).orderBy(desc(chats.opened), desc(chats.id)).limit(1).get();
    if (r) return r.id;
    const at = now();
    return this.db.insert(chats).values({ projectId, at, opened: at }).returning({ id: chats.id }).get().id;
  }

  /** The model of the chat new words go into, where the owner chose one. */
  model(projectId: string): AgentModel | undefined {
    return (this.db.select({ model: chats.model }).from(chats).where(eq(chats.id, this.current(projectId))).get()!.model as AgentModel | null) ?? undefined;
  }

  setModel(projectId: string, model?: AgentModel): void {
    this.db
      .update(chats)
      .set({ model: model ?? null })
      .where(and(eq(chats.id, this.current(projectId)), eq(chats.projectId, projectId)))
      .run();
  }

  private nextOpening(projectId: string): string {
    const latest = this.db.select({ opened: max(chats.opened) }).from(chats).where(eq(chats.projectId, projectId)).get();
    return new Date(Math.max(Date.now(), latest?.opened ? Date.parse(latest.opened) + 1 : 0)).toISOString();
  }

  /** A new chat to go on in; the current one while nothing was said in it yet. */
  start(projectId: string): number {
    const current = this.current(projectId);
    if (!this.db.select({ one: sql`1` }).from(talk).where(eq(talk.chat, current)).get()) return current;
    const at = this.nextOpening(projectId);
    return this.db.insert(chats).values({ projectId, at, opened: at }).returning({ id: chats.id }).get().id;
  }

  /** The owner goes back to chat `id`: new words go into it. A chat left without a word in it goes. Whether `id` is the project's. */
  open(projectId: string, id: number): boolean {
    if (!this.db.select({ one: sql`1` }).from(chats).where(and(eq(chats.id, id), eq(chats.projectId, projectId))).get()) return false;
    atomic(this.db, () => {
      this.db.update(chats).set({ opened: this.nextOpening(projectId) }).where(eq(chats.id, id)).run();
      this.db
        .delete(chats)
        .where(and(eq(chats.projectId, projectId), ne(chats.id, id), notExists(this.db.select({ one: sql`1` }).from(talk).where(eq(talk.chat, chats.id)))))
        .run();
    });
    return true;
  }

  /**
   * The chats with something said in them, the latest first, of one project or (none named) of all:
   * each with the owner's first words and when it was last talked in.
   */
  list(projectId?: string, limit = 200): Chat[] {
    const at = sql<string>`MAX(${talk.at})`;
    return this.db
      .select({
        id: chats.id,
        project: chats.projectId,
        model: chats.model,
        at,
        title: sql<string | null>`(SELECT said FROM talk f WHERE f.chat = ${chats.id} AND f.said != '' ORDER BY f.id LIMIT 1)`,
        unread: sql<number>`SUM(${talk.unread})`,
      })
      .from(chats)
      .innerJoin(talk, eq(talk.chat, chats.id))
      .where(projectId ? eq(chats.projectId, projectId) : undefined)
      .groupBy(chats.id)
      .orderBy(desc(at))
      .limit(limit)
      .all()
      .map((r) => ({ id: r.id, project: r.project, at: r.at, ...(r.model ? { model: r.model as AgentModel } : {}), ...(r.title ? { title: r.title } : {}), ...(r.unread ? { unread: r.unread } : {}) }));
  }
}
