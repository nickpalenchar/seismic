import { and, asc, Column, desc, eq, getTableColumns, inArray, is, isNotNull, isNull, ne, relations, SQL, sql } from 'drizzle-orm';
import { type AnySQLiteColumn, index, real, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AgentSetting, CardKind, CardState, Hold, Need, Queue } from '../../../core/types';
import { atomic, changes, type Db, now, SHORT } from '../common';
import type { Shipped, StoredThread } from '../../board';
import type { Scope } from '../../koordinator';
import type { LandedState, Unheard } from '../../workerSupervisor/workerSupervisor';
import { groups } from '../groups';
import { projects } from '../projects';
import { asDemo, type CardDemo, cardDemos, cardEarlierDemos, type DemoUpdate } from './demos';
import { asHold, cardHolds } from './holds';
import { type CardIdea, cardIdeas, type IdeaUpdate } from './ideas';
import { asLabels, type CardLabels, cardLabels, type LabelsUpdate } from './labels';
import { type CardPlan, cardPlans, type PlanUpdate } from './plans';
import { asReview, type CardReview, cardReviewItemEvents, cardReviewItems, cardReviews, type ReviewUpdate } from './reviews';


export const cards = sqliteTable(
  'cards',
  {
    id: text().primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id),
    kind: text().notNull().$type<CardKind>(),
    state: text().$type<CardState>(),
    need: text().$type<Need>(),
    title: text(),
    body: text(),
    x: real().notNull(),
    y: real().notNull(),
    parentId: text('parent_id').references((): AnySQLiteColumn => cards.id),
    planRef: text('plan_ref'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
    sessionId: text('session_id'),
    workstation: text(),
    branch: text(),
    statusLine: text('status_line'),
    detail: text({ mode: 'json' }),
    fromId: text('from_id').references((): AnySQLiteColumn => cards.id),
    scope: text({ mode: 'json' }).$type<Scope>(),
    queue: text({ mode: 'json' }).$type<Queue>(),
    repo: text(),
    archivedAt: text('archived_at'),
    approvedAt: text('approved_at'),
    landed: text({ mode: 'json' }).$type<LandedState>(),
    images: text({ mode: 'json' }).$type<string[]>(),
    retro: text(),
    groupId: text('group_id').references(() => groups.id),
    shipped: text({ mode: 'json' }).$type<Shipped>(),
    parked: text(),
    thread: text({ mode: 'json' }).$type<StoredThread>(),
    unheard: text({ mode: 'json' }).$type<Unheard[]>(),
    app: text(),
    keptIn: text('kept_in'),
    agentSetting: text('agent_setting', { mode: 'json' }).$type<AgentSetting>(),
    
    short: text(),
    
    canvasId: text('canvas_id'),
    stoppedAt: text('stopped_at', { mode: 'json' }),
  },
  (t) => [
    unique().on(t.projectId, t.planRef),
    uniqueIndex('cards_short').on(t.short),
    index('cards_canvas').on(t.canvasId),
    
    index('cards_open').on(t.projectId).where(sql`deleted_at IS NULL AND archived_at IS NULL`),
  ],
);

export interface CardRow {
  id: string;
  project_id: string;
  
  canvas_id: string;
  kind: CardKind;
  
  state: CardState | null;
  need: Need | null;
  title: string | null;
  body: string | null;
  x: number;
  y: number;
  parent_id: string | null;
  
  plan_ref: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  
  session_id: string | null;
  
  agent_setting: string | null;
  
  workstation: string | null;
  branch: string | null;
  
  status_line: string | null;
  
  detail: string | null;
  
  from_id: string | null;
  
  scope: string | null;
  
  queue: string | null;
  
  repo: string | null;
  
  archived_at: string | null;
  
  idea: CardIdea | null;
  
  review: CardReview | null;
  
  demo: CardDemo | null;
  
  plan: CardPlan | null;
  
  labels: CardLabels;
  
  hold: Hold | null;
  
  approved_at: string | null;
  



  landed: string | null;
  
  images: string | null;
  
  retro: string | null;
  
  group_id: string | null;
  




  shipped: string | null;
  
  parked: string | null;
  
  thread: string | null;
  
  unheard: string | null;
  
  app: string | null;
  




  kept_in: string | null;
  
  stopped_at: string | null;
  
  short: string;
}


export const PARTS = ['idea', 'review', 'demo', 'plan', 'labels', 'hold'] as const;
export type Part = (typeof PARTS)[number];


export interface PartsUpdate {
  idea?: IdeaUpdate;
  review?: ReviewUpdate;
  demo?: DemoUpdate;
  plan?: PlanUpdate;
  labels?: LabelsUpdate;
  hold?: Hold | null;
}





export type NewRow = Pick<CardRow, 'project_id' | 'kind' | 'x' | 'y'> &
  Partial<Pick<CardRow, 'canvas_id' | 'state' | 'title' | 'body' | 'parent_id' | 'plan_ref' | 'from_id' | 'repo' | 'images' | 'retro' | 'group_id'>> &
  PartsUpdate;


export type RowUpdate = Partial<Omit<CardRow, 'id' | 'project_id' | 'canvas_id' | 'parent_id' | 'plan_ref' | 'retro' | 'created_at' | 'updated_at' | Part>>;


export type CardUpdate = RowUpdate & PartsUpdate;


const NEW_FIELDS = ['id', 'short', 'project_id', 'canvas_id', 'kind', 'state', 'title', 'body', 'x', 'y', 'parent_id', 'plan_ref', 'from_id', 'repo', 'images', 'retro', 'group_id', 'created_at', 'updated_at'] as const;


const own = Object.fromEntries(Object.values(getTableColumns(cards)).map((c) => [c.name, sql`${c}`.as(c.name)]));







const READ = {
  ...own,
  idea: getTableColumns(cardIdeas),
  review: getTableColumns(cardReviews),
  demo: getTableColumns(cardDemos),
  plan: getTableColumns(cardPlans),
  hold: getTableColumns(cardHolds),
};







type ReadField = { part: string | null; key: string; column: Column | null };
const READ_FIELDS = Object.entries(READ).flatMap<ReadField>(([key, field]) =>
  is(field, SQL.Aliased) ? [{ part: null, key, column: null }] : Object.entries(field as Record<string, Column>).map(([k, column]) => ({ part: key, key: k, column })),
);

/** A row of READ as SQLite gives it, as Drizzle reads it: a left-joined part is null where its first column, the key, is. */
function fromValues(values: unknown[]): Omit<Read, 'earlierDemos' | 'labels' | 'reviewItems' | 'reviewEvents'> {
  const row: Record<string, unknown> = {};
  for (let i = 0; i < READ_FIELDS.length; i++) {
    const { part, key, column } = READ_FIELDS[i]!;
    const raw = values[i];
    const value = raw === null || !column ? raw : column.mapFromDriverValue(raw);
    if (!part) row[key] = value;
    else if (!(part in row)) row[part] = value === null ? null : { [key]: value };
    else if (row[part]) (row[part] as Record<string, unknown>)[key] = value;
  }
  return row as Omit<Read, 'earlierDemos' | 'labels' | 'reviewItems' | 'reviewEvents'>;
}


const keyOf = new Map(Object.entries(getTableColumns(cards)).map(([key, c]) => [c.name, key]));

/** Fields of a `CardRow` as values to write: under their keys in `cards`, as stored already (JSON as its text). */
function asStored(fields: Record<string, unknown>): Record<string, SQL> {
  return Object.fromEntries(
    Object.entries(fields).map(([name, v]) => {
      const key = keyOf.get(name);
      if (!key) throw new Error(`cards has no column ${name}`);
      return [key, sql`${v ?? null}`];
    }),
  );
}

export const cardsRelations = relations(cards, ({ one, many }) => ({
  idea: one(cardIdeas, { fields: [cards.id], references: [cardIdeas.cardId] }),
  review: one(cardReviews, { fields: [cards.id], references: [cardReviews.cardId] }),
  demo: one(cardDemos, { fields: [cards.id], references: [cardDemos.cardId] }),
  earlierDemos: many(cardEarlierDemos),
  plan: one(cardPlans, { fields: [cards.id], references: [cardPlans.cardId] }),
  labels: many(cardLabels),
  hold: one(cardHolds, { fields: [cards.id], references: [cardHolds.cardId] }),
}));


type Read = Omit<CardRow, 'demo' | 'labels' | 'hold' | 'review'> & {
  review: Parameters<typeof asReview>[0];
  reviewItems: Parameters<typeof asReview>[1];
  reviewEvents: Parameters<typeof asReview>[2];
  demo: Parameters<typeof asDemo>[0];
  earlierDemos: Parameters<typeof asDemo>[1];
  labels: Parameters<typeof asLabels>[0];
  hold: Parameters<typeof asHold>[0];
};

/** A card as read, as `CardRow`: the parts whose rows need putting together, put together. */
function toRow({ earlierDemos, demo, labels, hold, idea, review, reviewItems, reviewEvents, plan, ...row }: Read): CardRow {
  return { ...row, idea: keyless(idea), review: asReview(review, reviewItems, reviewEvents), demo: asDemo(demo, earlierDemos), plan: keyless(plan), labels: asLabels(labels), hold: asHold(hold) };
}

/** A part as joined, without the card's id it was read with. */
function keyless<T extends object>(part: T | null): Omit<T, 'cardId'> | null {
  if (!part) return null;
  const { cardId: _, ...rest } = part as T & { cardId?: string };
  return rest;
}

/** The rows of a part with several per card, of the cards `ids`, by card, each card's in order. */
function byCard<R extends { cardId: string }>(rows: R[]): Map<string, Omit<R, 'cardId'>[]> {
  const by = new Map<string, Omit<R, 'cardId'>[]>();
  for (const { cardId, ...r } of rows) (by.get(cardId) ?? by.set(cardId, []).get(cardId)!).push(r);
  return by;
}

const open = (projectId: string) => and(eq(cards.projectId, projectId), isNull(cards.deletedAt));

const proposed = sql`EXISTS (SELECT 1 FROM card_ideas i WHERE i.card_id = ${cards.id} AND i.proposal IS NOT NULL)`;

/** The cards' queries (`Store.cards`): rows as `CardRow` has them, the card's own columns as stored. */
export class Cards {
  private readonly taken;
  
  private readonly byId;
  private readonly open;
  private readonly earlier;
  private readonly labels;
  private readonly reviewItems;
  private readonly reviewEvents;

  constructor(private readonly db: Db) {
    this.taken = db.select({ one: sql`1` }).from(cards).where(eq(cards.short, sql.placeholder('short'))).prepare();
    this.byId = this.select(eq(cards.id, sql.placeholder('id'))).prepare();
    this.open = this.select(and(eq(cards.projectId, sql.placeholder('project')), isNull(cards.deletedAt), isNull(cards.archivedAt))).prepare();
    const ids = sql`(SELECT value FROM json_each(${sql.placeholder('ids')}))`;
    this.earlier = db
      .select({ cardId: cardEarlierDemos.cardId, demo: cardEarlierDemos.demo })
      .from(cardEarlierDemos)
      .where(inArray(cardEarlierDemos.cardId, ids))
      .orderBy(cardEarlierDemos.cardId, cardEarlierDemos.position)
      .prepare();
    this.labels = db.select({ cardId: cardLabels.cardId, label: cardLabels.label, value: cardLabels.value, by: cardLabels.by }).from(cardLabels).where(inArray(cardLabels.cardId, ids)).prepare();
    this.reviewItems = db.select().from(cardReviewItems).where(inArray(cardReviewItems.cardId, ids)).prepare();
    this.reviewEvents = db.select().from(cardReviewItemEvents).where(inArray(cardReviewItemEvents.cardId, ids)).prepare();
  }

  get(id: string): CardRow | null {
    return this.complete(this.byId.values({ id }).map(fromValues))[0] ?? null;
  }

  /** The cards `where` selects with their one-row parts (`READ`), in the order given. */
  private select(where: SQL | undefined, orderBy: SQL[] = []) {
    return this.db
      .select(READ)
      .from(cards)
      .leftJoin(cardIdeas, eq(cardIdeas.cardId, cards.id))
      .leftJoin(cardReviews, eq(cardReviews.cardId, cards.id))
      .leftJoin(cardDemos, eq(cardDemos.cardId, cards.id))
      .leftJoin(cardPlans, eq(cardPlans.cardId, cards.id))
      .leftJoin(cardHolds, eq(cardHolds.cardId, cards.id))
      .where(where)
      .orderBy(...orderBy);
  }

  /** The cards as read with their one-row parts, with the parts they have several rows of, as `CardRow`. */
  private complete(rows: unknown[]): CardRow[] {
    const read = rows as Omit<Read, 'earlierDemos' | 'labels' | 'reviewItems' | 'reviewEvents'>[];
    if (!read.length) return [];
    const ids = JSON.stringify(read.map((r) => r.id));
    const earlier = byCard(this.earlier.all({ ids }));
    const labels = byCard(this.labels.all({ ids }));
    const items = byCard(this.reviewItems.all({ ids }));
    const events = byCard(this.reviewEvents.all({ ids }));
    const withCard = <R extends object>(by: Map<string, Omit<R, 'cardId'>[]>, id: string) => (by.get(id) ?? []).map((r) => ({ ...r, cardId: id })) as R[];
    return read.map((r) => toRow({ ...r, earlierDemos: earlier.get(r.id) ?? [], labels: labels.get(r.id) ?? [], reviewItems: withCard(items, r.id), reviewEvents: withCard(events, r.id) }));
  }

  /** The cards `where` selects, as read, in the order given. */
  private rows(where: SQL | undefined, orderBy: SQL[] = []): CardRow[] {
    return this.complete(this.select(where, orderBy).values().map(fromValues));
  }

  /** The rows of these cards, deleted or archived ones too. */
  byIds(ids: string[]): CardRow[] {
    if (!ids.length) return [];
    return this.rows(inArray(cards.id, sql`(SELECT value FROM json_each(${JSON.stringify(ids)}))`));
  }

  /** Pending merge owners, including deleted and archived cards so deletion cannot hide a pair. */
  merging(projectId: string): CardRow[] {
    return this.rows(and(eq(cards.projectId, projectId), sql`EXISTS (SELECT 1 FROM card_ideas i WHERE i.card_id = ${cards.id} AND json_extract(i.proposal, '$.merge') IS NOT NULL)`));
  }

  /** Whether the project ever had a card, archived and deleted ones included. */
  hasCards(projectId: string): boolean {
    return !!this.db.select({ one: sql`1` }).from(cards).where(eq(cards.projectId, projectId)).limit(1).get();
  }

  /** Every card on the project: not deleted, not archived. */
  onProject(projectId: string): CardRow[] {
    return this.complete(this.open.values({ project: projectId }).map(fromValues));
  }

  /** The project's cards, archived ones too, that were ever shared or are about to be. */
  shared(projectId: string): CardRow[] {
    return this.rows(and(open(projectId), sql`EXISTS (SELECT 1 FROM card_demos d WHERE d.card_id = ${cards.id} AND d.share IS NOT NULL)`));
  }

  /** The project's archive, the most recently archived first. */
  archived(projectId: string): CardRow[] {
    return this.rows(and(open(projectId), isNotNull(cards.archivedAt)), [desc(cards.archivedAt), desc(cards.createdAt)]);
  }

  /** The project's plans, on the project or archived. */
  plans(projectId: string): CardRow[] {
    return this.rows(and(open(projectId), eq(cards.kind, 'plan'), isNotNull(cards.planRef)));
  }

  /** The cards whose landed work added plan docs, on the project or archived. */
  withPlanDocs(projectId: string): CardRow[] {
    
    return this.rows(and(open(projectId), inArray(cards.id, sql`(SELECT card_id FROM card_plans WHERE plan_docs IS NOT NULL)`)));
  }

  /** The workstreams of the given plans. */
  children(parentIds: string[]): CardRow[] {
    if (!parentIds.length) return [];
    return this.rows(and(isNull(cards.deletedAt), inArray(cards.parentId, parentIds)));
  }

  /** The proposals an agent made from a card, deleted and archived ones too, oldest first. */
  proposalsFrom(projectId: string, fromId: string): CardRow[] {
    return this.rows(and(eq(cards.projectId, projectId), eq(cards.fromId, fromId), proposed), [asc(cards.createdAt), sql`${cards}.rowid`]);
  }

  /** Of the given cards, those on another project than `projectId` and not deleted: with their project, its name and their title. */
  elsewhere(ids: string[], projectId: string): { id: string; project: string; projectName: string | null; title: string | null }[] {
    if (!ids.length) return [];
    return this.db
      .select({ id: cards.id, project: cards.projectId, projectName: projects.name, title: cards.title })
      .from(cards)
      .leftJoin(projects, eq(projects.id, cards.projectId))
      .where(and(inArray(cards.id, sql`(SELECT value FROM json_each(${JSON.stringify(ids)}))`), ne(cards.projectId, projectId), isNull(cards.deletedAt)))
      .all();
  }

  /** The cards in the group, on the project or in the archive. */
  inGroup(groupId: string): string[] {
    return this.db
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.groupId, groupId), isNull(cards.deletedAt)))
      .orderBy(sql`rowid`)
      .all()
      .map((r) => r.id);
  }

  /** The cards the work retrospective proposed for a repository (`null`: the home repository), oldest first, with what became of them. */
  retroProposals(projectId: string, repo: string | null): { title: string; retro: string; state: CardState; dismissed: boolean }[] {
    return this.db
      .select({ title: sql<string>`COALESCE(${cards.title}, '')`, retro: sql<string>`${cards.retro}`, state: sql<CardState>`COALESCE(${cards.state}, 'planned')`, deletedAt: cards.deletedAt })
      .from(cards)
      .where(and(eq(cards.projectId, projectId), isNotNull(cards.retro), sql`${cards.repo} IS ${repo ?? null}`))
      .orderBy(asc(cards.createdAt), sql`rowid`)
      .all()
      .map(({ deletedAt, ...r }) => ({ ...r, dismissed: !!deletedAt && r.state === 'proposal' }));
  }

  /**
   * Cards of the owner's deleted after `since` (ISO time), oldest first, with the state they had: a
   * worker's proposal the owner dismissed, say. Plan cards go with their plan doc, not by a click.
   */
  removed(projectId: string, since: string): { at: string; title: string; state: CardState }[] {
    
    return this.db
      .select({ at: sql<string>`${cards.deletedAt}`, title: sql<string>`${cards.title}`, state: sql<CardState>`COALESCE(${cards.state}, 'planned')` })
      .from(cards)
      .where(
        and(
          eq(cards.projectId, projectId),
          isNull(cards.planRef),
          sql`${cards.deletedAt} > ${since}`,
          sql`NOT (${cards.state} = 'proposal' AND (SELECT json_extract(${cardIdeas.proposal}, '$.superseded') FROM ${cardIdeas} WHERE ${cardIdeas.cardId} = ${cards.id}) IS NOT NULL)`,
        ),
      )
      .orderBy(cards.deletedAt)
      .all();
  }

  /** Stores new cards, each on the canvas it names, under a code of its own (`SHORT`), without their parts in tables of their own; returns their ids. */
  insert(rows: (Omit<NewRow, 'idea'> & { canvas_id: string })[]): string[] {
    return atomic(this.db, () =>
      rows.map((r) => {
        const id = crypto.randomUUID();
        
        const hex = id.replaceAll('-', '');
        let n = SHORT;
        while (n < hex.length && this.taken.get({ short: hex.slice(0, n) })) n++;
        const at = now();
        const fields: Record<string, unknown> = { ...r, id, short: hex.slice(0, n), created_at: at, updated_at: at };
        const unknown = Object.keys(r).find((k) => !(NEW_FIELDS as readonly string[]).includes(k));
        if (unknown) throw new Error(`a new card has no field ${unknown}`);
        this.db.insert(cards).values(asStored(Object.fromEntries(NEW_FIELDS.map((f) => [f, fields[f]]))) as unknown as typeof cards.$inferInsert).run();
        return id;
      }),
    );
  }

  update(id: string, fields: RowUpdate) {
    if (!Object.keys(fields).length) return;
    this.db.update(cards).set({ ...asStored(fields), updatedAt: now() }).where(eq(cards.id, id)).run();
  }

  /** The card counts as changed now: a part of it in a table of its own changed. */
  touch(id: string) {
    this.db.update(cards).set({ updatedAt: now() }).where(eq(cards.id, id)).run();
  }

  /**
   * Puts the card on another workstream (`planRef`, in plan `parentId`), or takes it out of its plan (both null).
   * A workstream is on its plan's canvas, so a card put into a plan takes it; one leaving keeps its own.
   */
  replan(id: string, planRef: string | null, parentId: string | null) {
    const set = { planRef, parentId, updatedAt: now() };
    this.db
      .update(cards)
      .set(parentId ? { ...set, canvasId: sql`(SELECT p.canvas_id FROM cards p WHERE p.id = ${parentId})` } : set)
      .where(eq(cards.id, id))
      .run();
  }

  /** The cards (plans with their workstreams) go onto the canvas, out of their groups, which stay on the canvas they leave. */
  setCanvas(cardIds: string[], canvasId: string) {
    atomic(this.db, () => {
      for (const id of cardIds)
        this.db
          .update(cards)
          .set({ canvasId, groupId: null, updatedAt: now() })
          .where(sql`${cards.id} = ${id} OR ${cards.parentId} = ${id}`)
          .run();
    });
  }

  /** Puts the cards into the group, or with `null` into none. */
  setGroup(cardIds: string[], groupId: string | null) {
    atomic(this.db, () => {
      for (const id of cardIds) this.db.update(cards).set({ groupId, updatedAt: now() }).where(eq(cards.id, id)).run();
    });
  }

  /** The card goes to another project, onto its canvas `canvasId`. */
  setProject(id: string, projectId: string, canvasId: string) {
    this.db.update(cards).set({ projectId, canvasId }).where(eq(cards.id, id)).run();
  }

  /** The cards of the group leave it. */
  ungroup(groupId: string) {
    this.db.update(cards).set({ groupId: null }).where(eq(cards.groupId, groupId)).run();
  }

  /** The project's deleted cards belong to no group: one that comes back has none any more. */
  ungroupDeleted(projectId: string) {
    this.db.update(cards).set({ groupId: null }).where(and(eq(cards.projectId, projectId), isNotNull(cards.deletedAt), isNotNull(cards.groupId))).run();
  }

  /** Deletes the owner's cards left empty (no title, text or screenshots), created before `before`; returns how many. */
  sweepUntitled(projectId: string, before: string): number {
    return changes(
      this.db
      .update(cards)
      .set({ deletedAt: now() })
      .where(
        and(
          eq(cards.projectId, projectId),
          isNull(cards.planRef),
          isNull(cards.deletedAt),
          eq(cards.state, 'planned'),
          sql`TRIM(COALESCE(${cards.title}, '')) = ''`,
          sql`TRIM(COALESCE(${cards.body}, '')) = ''`,
          isNull(cards.images),
          sql`${cards.createdAt} < ${before}`,
        ),
      )
      .run(),
    );
  }
}
