import { atomic, now } from '../schemas/common';
import { Canvases } from '../schemas/canvases';
import { type CardRow, Cards, type CardUpdate, type NewRow, type PartsUpdate, type RowUpdate } from '../schemas/cards/cards';
import { Demos } from '../schemas/cards/demos';
import { Holds } from '../schemas/cards/holds';
import { Ideas } from '../schemas/cards/ideas';
import { Labels } from '../schemas/cards/labels';
import { Plans } from '../schemas/cards/plans';
import { Reviews } from '../schemas/cards/reviews';
import type { DatabaseProvider } from './databaseProvider';
import { Repository, type RepositoryOptions } from './repository';

export interface CardRecord extends CardRow {}

/** A card as the database holds it: the fields of `CardRow`, its parts put together, deeply frozen. */
export class CardRecord {
  constructor(row: CardRow) {
    Object.assign(this, row);
    deepFreeze(this);
  }
}

function deepFreeze(value: object): void {
  Object.freeze(value);
  for (const inner of Object.values(value)) if (inner && typeof inner === 'object' && !Object.isFrozen(inner)) deepFreeze(inner);
}

export interface CardQuery {
  ids?: string[];
  projectId?: string;
}

/**
 * The cards, with their parts (idea, review, demo, plan, labels, hold). `delete` is the soft
 * deletion (`deleted_at`), and a deleted card can still be found by its id. `findMany` takes a
 * `CardQuery`: the `ids` (deleted and archived cards too) or the `projectId` (its open cards: not
 * deleted, not archived); one of the two is needed.
 *
 * Its cache is off (`Store` builds it with a time to live of 0) until every write to the card tables
 * goes through here: `Store.cards` and the parts' classes still write on their own, and a cached card
 * would be stale by up to a minute.
 *
 * `insertCards` and `applyUpdate` are the synchronous core of `create` and `update`, for `Store`'s
 * transactions, where nothing can be awaited; they go when `Store` does.
 */
export class CardRepository extends Repository<CardRecord, string, NewRow, CardUpdate, CardQuery> {
  private readonly cards: Cards;
  private readonly canvases: Canvases;
  private readonly ideas: Ideas;
  private readonly reviews: Reviews;
  private readonly demos: Demos;
  private readonly plans: Plans;
  private readonly labels: Labels;
  private readonly holds: Holds;

  constructor(database: DatabaseProvider, options?: RepositoryOptions) {
    super(database, options);
    const orm = database.orm;
    this.cards = new Cards(orm);
    this.canvases = new Canvases(orm);
    this.ideas = new Ideas(orm);
    this.reviews = new Reviews(orm);
    this.demos = new Demos(orm);
    this.plans = new Plans(orm);
    this.labels = new Labels(orm);
    this.holds = new Holds(orm);
  }

  /**
   * Stores new cards, with their parts: each on the canvas it names, else a workstream on its
   * plan's, else on its project's `main`.
   */
  insertCards(rows: NewRow[]): CardRow[] {
    const mains = new Map<string, string>();
    const main = (projectId: string) => mains.get(projectId) ?? mains.set(projectId, this.canvases.main(projectId)).get(projectId)!;
    const ids = atomic(this.database.orm, () => {
      const split = rows.map((row) => splitParts(row));
      const ids = this.cards.insert(
        split.map(([row]) => ({ ...row, canvas_id: row.canvas_id ?? (row.parent_id ? this.cards.get(row.parent_id)?.canvas_id : undefined) ?? main(row.project_id) })),
      );
      split.forEach(([, parts], i) => this.setParts(ids[i]!, parts));
      return ids;
    });
    return ids.map((id) => this.cards.get(id)!);
  }

  /** Changes the card's own fields and those of its parts, in one transaction; it counts as changed when only a part did. */
  applyUpdate(id: string, update: CardUpdate): void {
    const [fields, parts] = splitParts(update);
    atomic(this.database.orm, () => {
      const touched = this.setParts(id, parts);
      if (Object.keys(fields).length) this.cards.update(id, fields as RowUpdate);
      else if (touched) this.cards.touch(id);
    });
  }

  protected override idOf(record: CardRecord): string {
    return record.id;
  }

  protected override async findUncached(id: string): Promise<CardRecord | undefined> {
    const row = this.cards.get(id);
    return row ? new CardRecord(row) : undefined;
  }

  protected override async findManyUncached(query: CardQuery): Promise<CardRecord[]> {
    if (query.ids) return this.cards.byIds(query.ids).map((row) => new CardRecord(row));
    if (query.projectId) return this.cards.onProject(query.projectId).map((row) => new CardRecord(row));
    throw new Error('a card query needs ids or a projectId');
  }

  protected override async createUncached(input: NewRow): Promise<CardRecord> {
    return (await this.createManyUncached([input]))[0]!;
  }

  protected override async createManyUncached(inputs: NewRow[]): Promise<CardRecord[]> {
    return this.insertCards(inputs).map((row) => new CardRecord(row));
  }

  protected override async updateUncached(id: string, change: CardUpdate): Promise<CardRecord | undefined> {
    return (await this.updateManyUncached([id], change))[0];
  }

  protected override async updateManyUncached(ids: string[], change: CardUpdate): Promise<CardRecord[]> {
    return atomic(this.database.orm, () => {
      const existing = ids.filter((id) => this.cards.get(id));
      for (const id of existing) this.applyUpdate(id, change);
      return this.cards.byIds(existing).map((row) => new CardRecord(row));
    });
  }

  protected override async deleteUncached(id: string): Promise<boolean> {
    return (await this.deleteManyUncached([id])) > 0;
  }

  protected override async deleteManyUncached(ids: string[]): Promise<number> {
    return atomic(this.database.orm, () => {
      const alive = this.cards.byIds(ids).filter((row) => !row.deleted_at);
      for (const row of alive) this.applyUpdate(row.id, { deleted_at: now() });
      return alive.length;
    });
  }

  private setParts(id: string, parts: PartsUpdate): boolean {
    const { idea, review, demo, plan, labels, hold } = parts;
    if (idea) this.ideas.set(id, idea);
    if (review) this.reviews.set(id, review);
    if (demo) this.demos.set(id, demo);
    if (plan) this.plans.set(id, plan);
    if (labels) this.labels.set(id, labels);
    if (hold !== undefined) this.holds.set(id, hold);
    return [idea, review, demo, plan, labels].some((part) => part && Object.keys(part).length) || hold !== undefined;
  }
}

function splitParts<T extends PartsUpdate>(update: T): [Omit<T, keyof PartsUpdate>, PartsUpdate] {
  const { idea, review, demo, plan, labels, hold, ...fields } = update;
  const parts: PartsUpdate = { idea, review, demo, plan, labels, ...(hold !== undefined ? { hold } : {}) };
  return [fields, parts];
}
