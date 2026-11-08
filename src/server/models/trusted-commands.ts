import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { RepoCommands } from '../../core/types';

/** A repository's commands as the owner last confirmed them, by its path. */
export const trustedCommands = sqliteTable('trusted_commands', {
  repo: text().primaryKey(),
  commands: text({ mode: 'json' }).notNull().$type<RepoCommands>(),
  at: text().notNull(),
});
