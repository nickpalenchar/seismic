import { eq } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Db } from './common';

/** What a card changed in a folder without git, and the undo it has there (JSON `FolderCard`, folder.ts). */
export const folderCards = sqliteTable('folder_cards', {
  cardId: text('card_id').primaryKey(),
  folder: text().notNull(),
  state: text().notNull(),
});

/** The folder records' queries (`Store.folderCards`). */
export class FolderCards {
  constructor(private readonly db: Db) {}

  /** What the card changed in the folder without git it works in, as `folder.ts` keeps it (JSON); null where it has no record. */
  get(cardId: string): string | null {
    return this.db.select({ state: folderCards.state }).from(folderCards).where(eq(folderCards.cardId, cardId)).get()?.state ?? null;
  }

  /** The cards with a record in the folder at `folder`. */
  of(folder: string): { card_id: string; state: string }[] {
    return this.db.select({ card_id: folderCards.cardId, state: folderCards.state }).from(folderCards).where(eq(folderCards.folder, folder)).all();
  }

  /** Keeps the card's record in the folder; null removes it. */
  set(cardId: string, folder: string, state: string | null) {
    if (state === null) this.db.delete(folderCards).where(eq(folderCards.cardId, cardId)).run();
    else this.db.insert(folderCards).values({ cardId, folder, state }).onConflictDoUpdate({ target: folderCards.cardId, set: { folder, state } }).run();
  }
}
