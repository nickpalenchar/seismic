import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { SettingProposalState } from '../../core/types';
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
