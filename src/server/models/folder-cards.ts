import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** What a card changed in a folder without git, and the undo it has there (JSON `FolderCard`, folder.ts). */
export const folderCards = sqliteTable('folder_cards', {
  cardId: text('card_id').primaryKey(),
  folder: text().notNull(),
  state: text().notNull(),
});
