import { and, asc, eq, isNotNull, isNull, relations, sql } from 'drizzle-orm';
import { type AnySQLiteColumn, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Proposal } from '../../../core/types';
import type { StoredIdea, StoredNewRepo, StoredPrototype } from '../../board';
import type { Db } from '../common';
import { cards } from './cards';






export const cardIdeas = sqliteTable(
  'card_ideas',
  {
    cardId: text('card_id')
      .primaryKey()
      .references(() => cards.id),
    
    discussion: text({ mode: 'json' }).$type<StoredIdea>(),
    
    prototypeOf: text('prototype_of').references((): AnySQLiteColumn => cards.id),
    
    prototype: text({ mode: 'json' }).$type<StoredPrototype>(),
    
    proposal: text({ mode: 'json' }).$type<Proposal>(),
    
    builtOn: text('built_on').references((): AnySQLiteColumn => cards.id),
    
    becomesPlan: integer('becomes_plan', { mode: 'boolean' }).notNull().default(false),
    
    newRepo: text('new_repo', { mode: 'json' }).$type<StoredNewRepo>(),
  },
  (t) => [index('card_ideas_prototype_of').on(t.prototypeOf).where(sql`prototype_of IS NOT NULL`)],
);

export const cardIdeasRelations = relations(cardIdeas, ({ one }) => ({ card: one(cards, { fields: [cardIdeas.cardId], references: [cards.id] }) }));


export type CardIdea = Omit<typeof cardIdeas.$inferSelect, 'cardId'>;

export type IdeaUpdate = Partial<CardIdea>;


const EMPTY: CardIdea = { discussion: null, prototypeOf: null, prototype: null, proposal: null, builtOn: null, becomesPlan: false, newRepo: null };

/** The idea parts' queries (`Store.ideas`); they are read with their cards (`Cards`, `with: { idea: true }`). */
export class Ideas {
  
  private readonly ofProject;

  constructor(private readonly db: Db) {
    this.ofProject = db
      .select({ id: cards.id, prototype_of: sql<string>`${cardIdeas.prototypeOf}`, archived_at: cards.archivedAt })
      .from(cardIdeas)
      .innerJoin(cards, eq(cards.id, cardIdeas.cardId))
      .where(and(eq(cards.projectId, sql.placeholder('project')), isNull(cards.deletedAt), isNotNull(cardIdeas.prototypeOf)))
      .orderBy(asc(cards.createdAt), sql`${cards}.rowid`)
      .prepare();
  }

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
    return this.ofProject.all({ project: projectId });
  }
}
