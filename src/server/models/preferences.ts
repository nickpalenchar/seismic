import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type AnySQLiteColumn, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Preference, PreferenceState } from '../../core/types';
import { cards } from './cards/cards';
import { changes, type Db, now } from './common';
import { projects } from './projects';

/** The owner's standing preferences on a project, proposed, in force or set aside. */
export const preferences = sqliteTable('preferences', {
  id: integer().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  text: text().notNull(),
  cardId: text('card_id').references(() => cards.id),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at'),
  state: text().notNull().default('active').$type<PreferenceState>(),
  quote: text(),
  review: integer({ mode: 'boolean' }).notNull().default(false),
  replaces: integer().references((): AnySQLiteColumn => preferences.id),
  decidedAt: text('decided_at'),
  target: text(),
});

/** The preferences' queries (`Store.preferences`). */
export class Preferences {
  constructor(private readonly db: Db) {}

  /** The project's preferences, oldest first: those in the given states, or all. */
  of(projectId: string, states?: PreferenceState[]): Preference[] {
    return this.db
      .select()
      .from(preferences)
      .where(and(eq(preferences.projectId, projectId), isNull(preferences.deletedAt)))
      .orderBy(preferences.id)
      .all()
      .filter((r) => !states || states.includes(r.state))
      .map((r) => ({
        id: r.id,
        text: r.text,
        state: r.state,
        ...(r.cardId ? { cardId: r.cardId } : {}),
        ...(r.quote ? { quote: r.quote } : {}),
        ...(r.review ? { review: true } : {}),
        ...(r.replaces !== null ? { replaces: r.replaces } : {}),
        ...(r.target ? { target: r.target } : {}),
      }));
  }

  add(projectId: string, text: string, cardId: string | null, proposal?: { quote?: string; review?: boolean; replaces?: number; target?: string }): number {
    return this.db
      .insert(preferences)
      .values({
        projectId,
        text,
        cardId,
        createdAt: now(),
        state: proposal ? 'proposed' : 'active',
        quote: proposal?.quote ?? null,
        review: !!proposal?.review,
        replaces: proposal?.replaces ?? null,
        target: proposal?.target ?? null,
      })
      .returning({ id: preferences.id })
      .get().id;
  }

  /** A rule the owner gives outright for the CLAUDE.md of the repository `target`: filed at once, without a proposal. */
  fileRule(projectId: string, text: string, cardId: string | null, target: string): number {
    return this.db.insert(preferences).values({ projectId, text, cardId, createdAt: now(), state: 'filed', target }).returning({ id: preferences.id }).get().id;
  }

  /** Changes or (with `null`) deletes a preference of the project; returns whether it existed. */
  set(projectId: string, id: number, text: string | null): boolean {
    const which = and(eq(preferences.id, id), eq(preferences.projectId, projectId), isNull(preferences.deletedAt));
    const r = text === null ? this.db.update(preferences).set({ deletedAt: now() }).where(which).run() : this.db.update(preferences).set({ text }).where(which).run();
    return changes(r) > 0;
  }

  /**
   * Accepts or rejects an open proposal; returns whether there was one. Accepted, it becomes an
   * active rule, or one filed for the repository `target`, whose CLAUDE.md it goes into.
   */
  decide(projectId: string, id: number, state: 'active' | 'rejected', target?: string | null): boolean {
    const r = this.db
      .update(preferences)
      .set({ state: state === 'active' && target ? 'filed' : state, decidedAt: now(), ...(target === undefined ? {} : { target }) })
      .where(and(eq(preferences.id, id), eq(preferences.projectId, projectId), eq(preferences.state, 'proposed'), isNull(preferences.deletedAt)))
      .run();
    return changes(r) > 0;
  }

  /** Proposals the owner accepted or rejected after `since` (ISO time), oldest first. */
  decided(projectId: string, since: string): { at: string; text: string; state: 'active' | 'rejected' | 'filed'; quote?: string; target?: string }[] {
    return this.db
      .select({ at: sql<string>`${preferences.decidedAt}`, text: preferences.text, state: sql<'active' | 'rejected' | 'filed'>`${preferences.state}`, quote: preferences.quote, target: preferences.target })
      .from(preferences)
      .where(and(eq(preferences.projectId, projectId), gt(preferences.decidedAt, since)))
      .orderBy(preferences.decidedAt)
      .all()
      .map(({ quote, target, ...r }) => ({ ...r, ...(quote ? { quote } : {}), ...(target ? { target } : {}) }));
  }
}
