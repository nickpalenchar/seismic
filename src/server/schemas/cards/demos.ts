import { eq, relations, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { CardFile } from '../../../core/files';
import type { StoredDemo, StoredShare } from '../../board';
import type { PageHeard } from '../../workerSupervisor/workerSupervisor';
import { atomic, type Db } from '../common';
import { cards } from './cards';
import { setPart } from './part';







export const cardDemos = sqliteTable(
  'card_demos',
  {
    cardId: text('card_id')
      .primaryKey()
      .references(() => cards.id),
    
    latest: text({ mode: 'json' }).$type<StoredDemo>(),
    
    share: text({ mode: 'json' }).$type<StoredShare>(),
    
    pageHeard: text('page_heard', { mode: 'json' }).$type<PageHeard>(),
    
    files: text({ mode: 'json' }).$type<CardFile[]>(),
    
    held: text({ mode: 'json' }).$type<{ id: number; spoken?: true }[]>(),
  },
  (t) => [index('card_demos_shared').on(t.cardId).where(sql`share IS NOT NULL`)],
);


export const cardEarlierDemos = sqliteTable(
  'card_earlier_demos',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
    position: integer().notNull(),
    demo: text({ mode: 'json' }).notNull().$type<StoredDemo>(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.position] })],
);

export const cardDemosRelations = relations(cardDemos, ({ one }) => ({ card: one(cards, { fields: [cardDemos.cardId], references: [cards.id] }) }));
export const cardEarlierDemosRelations = relations(cardEarlierDemos, ({ one }) => ({ card: one(cards, { fields: [cardEarlierDemos.cardId], references: [cards.id] }) }));


export type CardDemo = Omit<typeof cardDemos.$inferSelect, 'cardId'> & { earlier: StoredDemo[] };

export type DemoUpdate = Partial<CardDemo>;

const EMPTY: Omit<CardDemo, 'earlier'> = { latest: null, share: null, pageHeard: null, files: null, held: null };

/** The demo part of a card as read (its row of `cardDemos`, its earlier demos), or none where it has none. */
export function asDemo(own: (Omit<CardDemo, 'earlier'> & { cardId?: string }) | null | undefined, earlier: { demo: StoredDemo }[]): CardDemo | null {
  if (!own && !earlier.length) return null;
  const { cardId: _, ...fields } = { ...EMPTY, ...own };
  return { ...fields, earlier: earlier.map((e) => e.demo) };
}

/** The demo parts' queries (`Store.demos`); they are read with their cards (`Cards`). */
export class Demos {
  constructor(private readonly db: Db) {}

  /**
   * Sets fields of the card's demo part: its row comes once any is set or it has earlier demos, and
   * goes once neither holds; `earlier` replaces the earlier demos.
   */
  set(cardId: string, { earlier, ...fields }: DemoUpdate) {
    if (!earlier && !Object.keys(fields).length) return;
    atomic(this.db, () => {
      if (earlier) {
        this.db.delete(cardEarlierDemos).where(eq(cardEarlierDemos.cardId, cardId)).run();
        if (earlier.length) this.db.insert(cardEarlierDemos).values(earlier.map((demo, position) => ({ cardId, position, demo }))).run();
      }
      const more = earlier ? earlier.length > 0 : !!this.db.select({ one: sql`1` }).from(cardEarlierDemos).where(eq(cardEarlierDemos.cardId, cardId)).get();
      setPart(this.db, cardDemos, EMPTY, cardId, fields, more);
    });
  }
}
