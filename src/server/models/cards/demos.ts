import { eq, relations, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { CardFile } from '../../../core/files';
import type { StoredDemo, StoredShare } from '../../board';
import type { PageHeard } from '../../workers';
import { atomic, type Db } from '../common';
import { cards } from './cards';
import { setPart } from './part';

/**
 * A card's demo part (`Item.demo`): its latest demo, the demo's page for colleagues, what its worker
 * last heard of that page, the files it named as the result, and the owner's comments held back
 * while they watch. A card has a row here once any of it is set or it has earlier demos, and none
 * again once all of it is cleared; the demos of earlier handovers are rows of `cardEarlierDemos`.
 */
export const cardDemos = sqliteTable(
  'card_demos',
  {
    cardId: text('card_id')
      .primaryKey()
      .references(() => cards.id),
    /** The card's latest demo (`{ kind, dir, chapters, question? }`; no `kind` is a video). */
    latest: text({ mode: 'json' }).$type<StoredDemo>(),
    /** The demo's page for colleagues; its slug stays once it was shared. */
    share: text({ mode: 'json' }).$type<StoredShare>(),
    /** What the card's worker last heard of its demo's page, so it hears of a change with its next step. */
    pageHeard: text('page_heard', { mode: 'json' }).$type<PageHeard>(),
    /** The files its worker named as the result at its latest handover that named any. */
    files: text({ mode: 'json' }).$type<CardFile[]>(),
    /** The owner's comments on places in the demo video Seismic holds back while they watch (event ids). */
    held: text({ mode: 'json' }).$type<{ id: number; spoken?: true }[]>(),
  },
  (t) => [index('card_demos_shared').on(t.cardId).where(sql`share IS NOT NULL`)],
);

/** The demos of a card's earlier handovers a later one replaced, each as its latest was, by `position` (the oldest is 0). */
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

/** A card's demo part as read with it (`CardRow.demo`): JSON parsed, with the earlier demos the oldest first. */
export type CardDemo = Omit<typeof cardDemos.$inferSelect, 'cardId'> & { earlier: StoredDemo[] };
/** Fields of a card's demo part to set; `null` (or an empty `earlier`) clears one. */
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
