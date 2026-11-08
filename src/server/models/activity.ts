import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { alias, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ActivityCode, ActivityWho } from '../../core/types';
import { cards } from './cards/cards';
import { type Db, now } from './common';

/** The Activity log: what happened on a card, by whom, with the card it waits for, the harness whose limit stopped it, or the title of a card it deleted. */
export const activity = sqliteTable(
  'activity',
  {
    id: integer().primaryKey(),
    at: text().notNull(),
    cardId: text('card_id').notNull().references(() => cards.id),
    who: text().notNull().$type<ActivityWho>(),
    code: text().notNull().$type<ActivityCode>(),
    otherId: text('other_id').references(() => cards.id),
    harness: text(),
    title: text(),
  },
  (t) => [index('activity_card').on(t.cardId, t.id)],
);

/** A line of the Activity log as stored, with the project of its card and the title of the card it waits for. */
export interface ActivityRow {
  id: number;
  at: string;
  who: ActivityWho;
  code: ActivityCode;
  cardId: string;
  otherId: string | null;
  otherTitle: string | null;
  harness: string | null;
  /** The card's title when it was deleted, on a `deleted` line. */
  title: string | null;
  projectId: string;
}

const other = alias(cards, 'o');

/** The Activity log's queries (`Store.activity`). */
export class Activity {
  constructor(private readonly db: Db) {}

  /**
   * Writes a line of the Activity log. A card waiting or limited repeats itself as its waits are read
   * again: `again` says which latest line of the card is the same one, and then nothing is written.
   */
  add(a: { cardId: string; code: ActivityCode; who: ActivityWho; otherId?: string; harness?: string; title?: string }, again?: (last: { code: ActivityCode; otherId: string | null; harness: string | null }) => boolean): boolean {
    if (again) {
      const last = this.db
        .select({ code: activity.code, otherId: activity.otherId, harness: activity.harness })
        .from(activity)
        .where(eq(activity.cardId, a.cardId))
        .orderBy(desc(activity.id))
        .limit(1)
        .get();
      if (last && again(last)) return false;
    }
    this.db.insert(activity).values({ at: now(), cardId: a.cardId, who: a.who, code: a.code, otherId: a.otherId ?? null, harness: a.harness ?? null, title: a.title ?? null }).run();
    return true;
  }

  /** The newest `limit` lines of the log of these projects (all when none are named) older than line `before`, newest first; one more than asked comes back when older lines remain. */
  page(projectIds: string[] | null, before: number | undefined, limit: number): ActivityRow[] {
    return this.db
      .select({
        id: activity.id,
        at: activity.at,
        who: activity.who,
        code: activity.code,
        cardId: activity.cardId,
        otherId: activity.otherId,
        harness: activity.harness,
        title: activity.title,
        projectId: cards.projectId,
        otherTitle: other.title,
      })
      .from(activity)
      .innerJoin(cards, eq(cards.id, activity.cardId))
      .leftJoin(other, eq(other.id, activity.otherId))
      .where(
        and(
          before == null ? undefined : lt(activity.id, before),
          projectIds ? inArray(cards.projectId, sql`(SELECT value FROM json_each(${JSON.stringify(projectIds)}))`) : undefined,
        ),
      )
      .orderBy(desc(activity.id))
      .limit(limit + 1)
      .all();
  }
}
