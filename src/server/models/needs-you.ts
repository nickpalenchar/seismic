import { and, eq, isNull, sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { digest } from '../../core/inbox';
import type { NeedsYou as NeedsYouView, NeedsYouKind } from '../../core/waits';
import { cards } from './cards/cards';
import { atomic, type Db } from './common';
import { preferences } from './preferences';
import { projects } from './projects';
import { settingProposals } from './setting-proposals';
import { talk } from './talk';

/**
 * Each wait for the owner ("Needs you"): what waits (a card, a proposed rule, a setting proposal or
 * the Koordinator's answer, exactly one), since when, when what it waits on last changed, and when it
 * ended. A row stays once its wait ended; a target that waits again gets a new one.
 */
export const needsYou = sqliteTable(
  'needs_you',
  {
    id: integer().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    kind: text().notNull().$type<NeedsYouKind>(),
    cardId: text('card_id').references(() => cards.id),
    preferenceId: integer('preference_id').references(() => preferences.id),
    settingProposalId: integer('setting_proposal_id').references(() => settingProposals.id),
    talkId: integer('talk_id').references(() => talk.id),
    /** A digest of what it waits for (the question, the summary), to tell it changed; null on a wait moved over from before the table, taken as it is at its first reconcile. */
    digest: text(),
    /** When the wait began (ms). */
    createdAt: integer('created_at').notNull(),
    /** When what the owner waits on last changed (ms): its kind, or what it waits for. */
    lastUpdated: integer('last_updated').notNull(),
    /** When the wait ended (ms); null while it is open. */
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    check('needs_you_one_target', sql`(card_id IS NOT NULL) + (preference_id IS NOT NULL) + (setting_proposal_id IS NOT NULL) + (talk_id IS NOT NULL) = 1`),
    // at most one open wait per target
    uniqueIndex('needs_you_open_card').on(t.cardId).where(sql`resolved_at IS NULL`),
    uniqueIndex('needs_you_open_preference').on(t.preferenceId).where(sql`resolved_at IS NULL`),
    uniqueIndex('needs_you_open_setting').on(t.settingProposalId).where(sql`resolved_at IS NULL`),
    uniqueIndex('needs_you_open_talk').on(t.talkId).where(sql`resolved_at IS NULL`),
    index('needs_you_open').on(t.projectId).where(sql`resolved_at IS NULL`),
  ],
);

/** What waits for the owner by one row: exactly one target. */
export type NeedsYouTarget = { card: string } | { preference: number } | { setting: number } | { talk: number };

/** What waits for the owner now, as the board finds it: its target, kind and what it waits for. A wait begins at the reconcile that first finds it. */
export interface Wait {
  target: NeedsYouTarget;
  kind: NeedsYouKind;
  /** What it waits for (all the owner decides on a card, `decidedOn`; the rule's text; the answer): a change to it is an update. */
  text: string;
}

type Row = typeof needsYou.$inferSelect;

const keyOf = (t: NeedsYouTarget) => ('card' in t ? `card:${t.card}` : 'preference' in t ? `preference:${t.preference}` : 'setting' in t ? `setting:${t.setting}` : `talk:${t.talk}`);
const rowKey = (r: Row) => (r.cardId != null ? `card:${r.cardId}` : r.preferenceId != null ? `preference:${r.preferenceId}` : r.settingProposalId != null ? `setting:${r.settingProposalId}` : `talk:${r.talkId}`);

const view = (r: Row): NeedsYouView => ({
  id: r.id,
  kind: r.kind,
  ...(r.cardId != null ? { card: r.cardId } : {}),
  ...(r.preferenceId != null ? { preference: r.preferenceId } : {}),
  ...(r.settingProposalId != null ? { setting: r.settingProposalId } : {}),
  ...(r.talkId != null ? { talk: r.talkId } : {}),
  createdAt: r.createdAt,
  lastUpdated: r.lastUpdated,
});

/** The waits' queries (`Store.needsYou`). */
export class NeedsYou {
  /** The time the last reconcile wrote; null until the first reads it from the table. */
  private last: number | null = null;

  constructor(private readonly db: Db) {}

  /** The project's open waits, the oldest first. */
  open(projectId: string): NeedsYouView[] {
    return this.rows(projectId).map(view);
  }

  /** Every wait of the project, ended ones too, the oldest first. */
  all(projectId: string): (NeedsYouView & { resolvedAt: number | null })[] {
    return this.db
      .select()
      .from(needsYou)
      .where(eq(needsYou.projectId, projectId))
      .orderBy(needsYou.id)
      .all()
      .map((r) => ({ ...view(r), resolvedAt: r.resolvedAt }));
  }

  /**
   * Brings the project's open waits in line with what waits now (`waits`): a target that waits and
   * had no open row gets one; an open row whose kind or text changed counts as updated `at`; an open
   * row whose target no longer waits ends `at`: now, though always after the reconcile before, so
   * that two changes in the same millisecond (or after the clock went back) keep their order.
   * Returns the open rows, the oldest first.
   */
  reconcile(projectId: string, waits: Wait[]): NeedsYouView[] {
    return atomic(this.db, () => {
      this.last ??= this.db.select({ t: sql<number | null>`max(max(${needsYou.lastUpdated}), coalesce(max(${needsYou.resolvedAt}), 0))` }).from(needsYou).get()?.t ?? 0;
      const at = Math.max(Date.now(), this.last + 1);
      let wrote = false;
      const open = new Map(this.rows(projectId).map((r) => [rowKey(r), r]));
      const seen = new Set<string>();
      for (const w of waits) {
        const key = keyOf(w.target);
        if (seen.has(key)) continue;
        seen.add(key);
        const d = digest(w.text);
        const r = open.get(key);
        if (!r || r.kind !== w.kind || r.digest !== d) wrote = true;
        if (!r) {
          const t = w.target;
          this.db
            .insert(needsYou)
            .values({
              projectId,
              kind: w.kind,
              cardId: 'card' in t ? t.card : null,
              preferenceId: 'preference' in t ? t.preference : null,
              settingProposalId: 'setting' in t ? t.setting : null,
              talkId: 'talk' in t ? t.talk : null,
              digest: d,
              createdAt: at,
              lastUpdated: at,
            })
            .run();
        } else if (r.digest === null) this.db.update(needsYou).set({ kind: w.kind, digest: d }).where(eq(needsYou.id, r.id)).run();
        else if (r.kind !== w.kind || r.digest !== d) this.db.update(needsYou).set({ kind: w.kind, digest: d, lastUpdated: at }).where(eq(needsYou.id, r.id)).run();
      }
      for (const [key, r] of open) {
        if (seen.has(key)) continue;
        this.db.update(needsYou).set({ resolvedAt: at }).where(eq(needsYou.id, r.id)).run();
        wrote = true;
      }
      if (wrote) this.last = at;
      return this.open(projectId);
    });
  }

  private rows(projectId: string): Row[] {
    return this.db
      .select()
      .from(needsYou)
      .where(and(eq(needsYou.projectId, projectId), isNull(needsYou.resolvedAt)))
      .orderBy(needsYou.id)
      .all();
  }
}
