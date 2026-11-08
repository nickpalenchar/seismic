import { and, asc, eq, isNotNull, isNull, relations, sql } from 'drizzle-orm';
import { type AnySQLiteColumn, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Proposal } from '../../../core/types';
import type { StoredIdea, StoredNewRepo, StoredPrototype } from '../../board';
import type { Db } from '../common';
import { cards } from './cards';

/**
 * A card's idea part (`Item.idea`): what it holds as an idea, a prototype, a worker's proposal, or
 * a card decided to become a plan or built in a new repository. A card has a row here once any of
 * it is set, and none again once all of it is cleared.
 */
export const cardIdeas = sqliteTable(
  'card_ideas',
  {
    cardId: text('card_id')
      .primaryKey()
      .references(() => cards.id),
    /** An idea's discussion as it stands (`{ status, brief, … }`), kept once it was decided. */
    discussion: text({ mode: 'json' }).$type<StoredIdea>(),
    /** A prototype's idea. */
    prototypeOf: text('prototype_of').references((): AnySQLiteColumn => cards.id),
    /** Prototypes only: how it ended (`end`, once archived) and its worker's proposal to build the idea on it (`proposal`). */
    prototype: text({ mode: 'json' }).$type<StoredPrototype>(),
    /** While a worker's proposal waits, and after the owner accepted it: an idea or a task, why, the questions to decide. */
    proposal: text({ mode: 'json' }).$type<Proposal>(),
    /** A card that was an idea and is built on the branch of one of its prototypes: that prototype. */
    builtOn: text('built_on').references((): AnySQLiteColumn => cards.id),
    /** Once the owner decided the card (an idea or a task of theirs) becomes a plan: its worker writes the plan doc, and the plan takes its place. */
    becomesPlan: integer('becomes_plan', { mode: 'boolean' }).notNull().default(false),
    /** A repository to create for the card before work begins (`NewRepo`); once Seismic made it, `{ path, project, made: true }`. */
    newRepo: text('new_repo', { mode: 'json' }).$type<StoredNewRepo>(),
  },
  (t) => [index('card_ideas_prototype_of').on(t.prototypeOf).where(sql`prototype_of IS NOT NULL`)],
);

export const cardIdeasRelations = relations(cardIdeas, ({ one }) => ({ card: one(cards, { fields: [cardIdeas.cardId], references: [cards.id] }) }));

/** A card's idea part as read with it (`CardRow.idea`): JSON parsed, `becomesPlan` a boolean. */
export type CardIdea = Omit<typeof cardIdeas.$inferSelect, 'cardId'>;
/** Fields of a card's idea part to set; `null` (or `false`) clears one. */
export type IdeaUpdate = Partial<CardIdea>;

/** The fields of an idea part with nothing in it. */
const EMPTY: CardIdea = { discussion: null, prototypeOf: null, prototype: null, proposal: null, builtOn: null, becomesPlan: false, newRepo: null };

/** The idea parts' queries (`Store.ideas`); they are read with their cards (`Cards`, `with: { idea: true }`). */
export class Ideas {
  constructor(private readonly db: Db) {}

  /** Sets fields of the card's idea part: its row comes once any is set, and goes once none is. */
  set(cardId: string, fields: IdeaUpdate) {
    if (!Object.keys(fields).length) return;
    const was = this.db.select().from(cardIdeas).where(eq(cardIdeas.cardId, cardId)).get();
    const { cardId: _, ...next } = { ...EMPTY, ...was, ...fields };
    const empty = Object.entries(next).every(([k, v]) => v === EMPTY[k as keyof CardIdea] || v === undefined);
    if (empty) {
      if (was) this.db.delete(cardIdeas).where(eq(cardIdeas.cardId, cardId)).run();
    } else if (was) this.db.update(cardIdeas).set(next).where(eq(cardIdeas.cardId, cardId)).run();
    else this.db.insert(cardIdeas).values({ cardId, ...next }).run();
  }

  /** The project's prototypes, on the project or archived, the oldest first: which they are, of which idea, without the rest of their rows. */
  prototypes(projectId: string): { id: string; prototype_of: string; archived_at: string | null }[] {
    return this.db
      .select({ id: cards.id, prototype_of: sql<string>`${cardIdeas.prototypeOf}`, archived_at: cards.archivedAt })
      .from(cardIdeas)
      .innerJoin(cards, eq(cards.id, cardIdeas.cardId))
      .where(and(eq(cards.projectId, projectId), isNull(cards.deletedAt), isNotNull(cardIdeas.prototypeOf)))
      .orderBy(asc(cards.createdAt), sql`${cards}.rowid`)
      .all();
  }
}
