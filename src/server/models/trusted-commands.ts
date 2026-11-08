import { eq } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { type Db, now } from './common';
import type { RepoCommands } from '../../core/types';

/** A repository's commands as the owner last confirmed them, by its path. */
export const trustedCommands = sqliteTable('trusted_commands', {
  repo: text().primaryKey(),
  commands: text({ mode: 'json' }).notNull().$type<RepoCommands>(),
  at: text().notNull(),
});

/** The confirmed commands' queries (`Store.trustedCommands`). */
export class TrustedCommands {
  constructor(private readonly db: Db) {}

  /** The commands of the repository at `path` as the owner last confirmed them; null where they confirmed none. */
  get(path: string): RepoCommands | null {
    return this.db.select({ commands: trustedCommands.commands }).from(trustedCommands).where(eq(trustedCommands.repo, path)).get()?.commands ?? null;
  }

  trust(path: string, commands: RepoCommands) {
    const at = now();
    this.db.insert(trustedCommands).values({ repo: path, commands, at }).onConflictDoUpdate({ target: trustedCommands.repo, set: { commands, at } }).run();
  }
}
