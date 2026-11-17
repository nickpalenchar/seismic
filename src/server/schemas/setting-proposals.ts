import { and, eq, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ProposedSetting, SettingProposal, SettingProposalState } from '../../core/types';
import { cards as cardsTable } from './cards/cards';
import { changes, type Db, now } from './common';
import { projects } from './projects';

/** A value for a repository's setting the work retrospective proposes, and where the owner took it. */
export const settingProposals = sqliteTable('setting_proposals', {
  id: integer().primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  repo: text().notNull(),
  field: text().notNull(),
  value: text({ mode: 'json' }).notNull().$type<string | string[]>(),
  basis: text().notNull(),
  /** The ids of the cards it rests on. */
  cards: text({ mode: 'json' }).notNull().$type<string[]>(),
  state: text().notNull().default('proposed').$type<SettingProposalState>(),
  createdAt: text('created_at').notNull(),
  decidedAt: text('decided_at'),
});

/** The setting proposals' queries (`Store.settingProposals`). */
export class SettingProposals {
  constructor(private readonly db: Db) {}

  add(projectId: string, p: Omit<SettingProposal, 'id' | 'cards'> & { cards: string[] }): number {
    return this.db
      .insert(settingProposals)
      .values({ projectId, repo: p.repo, field: p.field, value: p.value, basis: p.basis, cards: p.cards, createdAt: now() })
      .returning({ id: settingProposals.id })
      .get().id;
  }

  /** The settings the work retrospective proposed, oldest first, with what became of them: those of a repository, or all; the cards they rest on with their titles. */
  of(projectId: string, repo?: string): (SettingProposal & { state: SettingProposalState })[] {
    const rows = this.db
      .select()
      .from(settingProposals)
      .where(and(eq(settingProposals.projectId, projectId), repo == null ? undefined : eq(settingProposals.repo, repo)))
      .orderBy(settingProposals.id)
      .all();
    const title = (id: string) => this.db.select({ title: sql<string>`COALESCE(${cardsTable.title}, '')` }).from(cardsTable).where(eq(cardsTable.id, id)).get()?.title ?? '';
    return rows.map((r) => ({
      id: r.id,
      repo: r.repo,
      field: r.field as ProposedSetting,
      value: r.value,
      basis: r.basis,
      cards: r.cards.map((id) => ({ id, title: title(id) })),
      state: r.state,
    }));
  }

  /** Decides a waiting setting proposal, with the value the owner took; whether one waited. */
  decide(projectId: string, id: number, state: Exclude<SettingProposalState, 'proposed'>, value?: string | string[]): boolean {
    const r = this.db
      .update(settingProposals)
      .set({ state, decidedAt: now(), ...(value === undefined ? {} : { value }) })
      .where(and(eq(settingProposals.projectId, projectId), eq(settingProposals.id, id), eq(settingProposals.state, 'proposed')))
      .run();
    return changes(r) > 0;
  }
}
