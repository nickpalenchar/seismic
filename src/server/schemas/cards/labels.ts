import { and, eq, relations } from 'drizzle-orm';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { type Label, LABELS, type Labels as LabelValues } from '../../../core/labels';
import { atomic, type Db } from '../common';
import { cards } from './cards';

/**
 * A card's labels (`Item.labels`), one row per label it has: its value (none where the owner set it
 * to none) and who set it, the owner or Seismic's suggestion. A label nobody set has no row.
 */
export const cardLabels = sqliteTable(
  'card_labels',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
    label: text().notNull().$type<Label>(),
    /** As text, the complexity too; null where the owner set the label to none. */
    value: text(),
    /** `owner`: Seismic suggests no other value again; `suggestion`: Seismic's, which the owner has not touched since; null for one set before either was told apart. */
    by: text().$type<LabelBy>(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.label] })],
);

export type LabelBy = 'owner' | 'suggestion';

export const cardLabelsRelations = relations(cardLabels, ({ one }) => ({ card: one(cards, { fields: [cardLabels.cardId], references: [cards.id] }) }));

/** A card's label as it is set: its value (none: set to none) and by whom. */
export interface CardLabel<L extends Label = Label> {
  value: NonNullable<LabelValues[L]> | null;
  by: LabelBy | null;
}
/** A card's labels as read with it (`CardRow.labels`), those it has. */
export type CardLabels = { [L in Label]?: CardLabel<L> };
/** Labels to set on a card; `null` takes one off. */
export type LabelsUpdate = { [L in Label]?: CardLabel<L> | null };

/** The labels of a card as its rows have them (`Cards.rows`). */
export function asLabels(rows: { label: Label; value: string | null; by: LabelBy | null }[]): CardLabels {
  return Object.fromEntries(
    rows.filter((r) => LABELS.includes(r.label)).map((r) => [r.label, { value: r.value !== null && r.label === 'complexity' ? Number(r.value) : r.value, by: r.by }]),
  ) as CardLabels;
}

/** The labels' queries (`Store.labels`); they are read with their cards (`Cards`). */
export class Labels {
  constructor(private readonly db: Db) {}

  /** Sets the card's labels, each a row of its own: one set to nothing by nobody has none. */
  set(cardId: string, labels: LabelsUpdate) {
    atomic(this.db, () => {
      for (const [label, l] of Object.entries(labels) as [Label, CardLabel | null][]) {
        const where = and(eq(cardLabels.cardId, cardId), eq(cardLabels.label, label));
        if (!l || (l.value === null && l.by === null)) {
          this.db.delete(cardLabels).where(where).run();
          continue;
        }
        const row = { value: l.value === null ? null : String(l.value), by: l.by };
        this.db.insert(cardLabels).values({ cardId, label, ...row }).onConflictDoUpdate({ target: [cardLabels.cardId, cardLabels.label], set: row }).run();
      }
    });
  }
}
