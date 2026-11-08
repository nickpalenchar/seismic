import { and, asc, count, desc, eq, getTableColumns, inArray, isNotNull, isNull, ne, type SQL, sql } from 'drizzle-orm';
import { type AnySQLiteColumn, index, integer, real, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { CardFile } from '../../../core/files';
import type { Category, Complexity, Label, Priority, Subcategory } from '../../../core/labels';
import type { PlanDoc } from '../../../core/plan-doc';
import type { AgentSetting, CardKind, CardState, Need, Proposal, Queue, Snooze } from '../../../core/types';
import { atomic, changes, type Db, now, SHORT, stored } from '../common';
import type { PrState, Shipped, StoredCodeReview, StoredContribution, StoredDemo, StoredDeps, StoredIdea, StoredNewRepo, StoredPrototype, StoredShare, StoredThread } from '../../board';
import type { Scope } from '../../koordinator';
import type { LandedState, PageHeard, PausedState, Unheard } from '../../workers';
import { groups } from '../groups';
import { projects } from '../projects';

/** Every card, whatever its kind; what each column holds is described on `CardRow`. */
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
    pr: text({ mode: 'json' }).$type<PrState>(),
    repo: text(),
    demo: text({ mode: 'json' }).$type<StoredDemo>(),
    archivedAt: text('archived_at'),
    idea: text({ mode: 'json' }).$type<StoredIdea>(),
    prototypeOf: text('prototype_of').references((): AnySQLiteColumn => cards.id),
    approvedAt: text('approved_at'),
    landed: text({ mode: 'json' }).$type<LandedState>(),
    images: text({ mode: 'json' }).$type<string[]>(),
    plan: text({ mode: 'json' }).$type<PlanDoc>(),
    planDocs: text('plan_docs', { mode: 'json' }).$type<string[]>(),
    prototype: text({ mode: 'json' }).$type<StoredPrototype>(),
    builtOn: text('built_on').references((): AnySQLiteColumn => cards.id),
    share: text({ mode: 'json' }).$type<StoredShare>(),
    retro: text(),
    proposal: text({ mode: 'json' }).$type<Proposal>(),
    groupId: text('group_id').references(() => groups.id),
    shipped: text({ mode: 'json' }).$type<Shipped>(),
    parked: text(),
    held: text({ mode: 'json' }).$type<{ id: number }[]>(),
    becomesPlan: integer('becomes_plan', { mode: 'boolean' }).notNull().default(false),
    thread: text({ mode: 'json' }).$type<StoredThread>(),
    paused: text({ mode: 'json' }).$type<PausedState>(),
    unheard: text({ mode: 'json' }).$type<Unheard[]>(),
    app: text(),
    demos: text({ mode: 'json' }).$type<StoredDemo[]>(),
    waitingSince: text('waiting_since'),
    snoozed: text({ mode: 'json' }).$type<Snooze>(),
    files: text({ mode: 'json' }).$type<CardFile[]>(),
    deps: text({ mode: 'json' }).$type<StoredDeps>(),
    collapsed: integer({ mode: 'boolean' }).notNull().default(false),
    keptIn: text('kept_in'),
    contribution: text({ mode: 'json' }).$type<StoredContribution>(),
    newRepo: text('new_repo', { mode: 'json' }).$type<StoredNewRepo>(),
    pageHeard: text('page_heard', { mode: 'json' }).$type<PageHeard>(),
    pausing: text(),
    agentSetting: text('agent_setting', { mode: 'json' }).$type<AgentSetting>(),
    /** Set on every card (`SHORT` in db.ts); nullable only because it was added to a table that had rows. */
    short: text(),
    priority: text().$type<Priority>(),
    category: text().$type<Category>(),
    subcategory: text().$type<Subcategory>(),
    complexity: integer().$type<Complexity>(),
    suggestedLabels: text('suggested_labels', { mode: 'json' }).$type<Label[]>(),
    ownerLabels: text('owner_labels', { mode: 'json' }).$type<Label[]>(),
    codeReview: text('code_review', { mode: 'json' }).$type<StoredCodeReview>(),
    /** No foreign key, which would keep a canvas from ever being dropped: the store keeps it valid. */
    canvasId: text('canvas_id'),
    parkingLot: text('parking_lot'),
  },
  (t) => [
    unique().on(t.projectId, t.planRef),
    uniqueIndex('cards_short').on(t.short),
    index('cards_canvas').on(t.canvasId),
    // the cards each change of a project reads, without going through its archive
    index('cards_open').on(t.projectId).where(sql`deleted_at IS NULL AND archived_at IS NULL`),
    index('cards_plan_docs').on(t.projectId).where(sql`deleted_at IS NULL AND plan_docs IS NOT NULL`),
    index('cards_prototypes').on(t.projectId, t.createdAt).where(sql`deleted_at IS NULL AND prototype_of IS NOT NULL`),
    index('cards_waiting').on(t.projectId).where(sql`waiting_since IS NOT NULL`),
    index('cards_shared').on(t.projectId).where(sql`deleted_at IS NULL AND share IS NOT NULL`),
  ],
);

export interface CardRow {
  id: string;
  project_id: string;
  /** The canvas of the project it is on; a workstream's is its plan's. */
  canvas_id: string;
  kind: CardKind;
  /** Null on plan cards: the state comes from the plan doc. */
  state: CardState | null;
  need: Need | null;
  title: string | null;
  body: string | null;
  x: number;
  y: number;
  parent_id: string | null;
  /** `docs/plan/x.md` for a plan, `docs/plan/x.md#W3` for a workstream; null for manual cards. */
  plan_ref: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Agent session of the card's worker, or of a plan's plan agent. */
  session_id: string | null;
  /** JSON AgentSetting pinned before a worker starts; null on legacy Claude sessions. */
  agent_setting: string | null;
  /** Leased clone and branch while a worker has the card. */
  workstation: string | null;
  branch: string | null;
  /** The worker's latest `report`. */
  status_line: string | null;
  /** JSON: the open question (`{ text, options }`) or the review summary (`{ summary }`). */
  detail: string | null;
  /** A proposal's source card. */
  from_id: string | null;
  /** JSON: the Koordinator's estimate of the files the card changes (`{ files, reason }`). */
  scope: string | null;
  /** JSON: set while the Koordinator decides (`{ checking: true }`) or the card waits (`{ behind, reason }`), with `since`. */
  queue: string | null;
  /** JSON: the card's pull request once approval opened the PR phase (`PrState`); on a review card, the one it reviews from the start. */
  pr: string | null;
  /** JSON, review cards only: the contributor's pull request the card reviews (`StoredContribution` in board.ts). */
  contribution: string | null;
  /** JSON: the code review of the card's work where its project reviews work that lands on main (`StoredCodeReview` in board.ts). */
  code_review: string | null;
  /** The owner's card's repository on a project with several; null is the home repository. */
  repo: string | null;
  /** JSON: the card's latest demo (`{ kind, dir, chapters, question? }`; no `kind` is a video). */
  demo: string | null;
  /** JSON: the demos of earlier handovers a later one replaced, the oldest first, each as `demo` was; append only. */
  demos: string | null;
  /** When the owner took the finished card off the project into the archive. */
  archived_at: string | null;
  /** JSON: an idea's status and brief (`{ status, brief }`). */
  idea: string | null;
  /** A prototype's idea. */
  prototype_of: string | null;
  /** When the owner approved work that could not land yet; its next handover lands without asking again. */
  approved_at: string | null;
  /**
   * JSON, while the card's work is on main and its worker finishes what remains (its workstation and
   * session are kept until then): `{ commit?, restart? }`, `restart` when it waits for Seismic to run the change.
   */
  landed: string | null;
  /** JSON: ids of the screenshots the owner attached to the card's task. */
  images: string | null;
  /** JSON, plans only: the plan doc as last read (`PlanDoc`), kept for the archive once the doc is gone. */
  plan: string | null;
  /** A card the work retrospective proposed: what it rests on. */
  retro: string | null;
  /** JSON, while a worker's proposal waits: `Proposal` (an idea or a task, why, the questions to decide). */
  proposal: string | null;
  /** JSON: the plan docs (plan references) the landed work of a card that was an idea added. */
  plan_docs: string | null;
  /** JSON, prototypes only: how it ended (`end`, once archived) and its worker's proposal to build the idea on it (`proposal`). */
  prototype: string | null;
  /** A card that was an idea and is built on the branch of one of its prototypes: that prototype. */
  built_on: string | null;
  /** JSON: the demo's page for colleagues (`StoredShare` in share.ts); its slug stays once it was shared. */
  share: string | null;
  /** The group the card belongs to; a plan's covers its workstreams, whose own stays null. */
  group_id: string | null;
  /**
   * JSON, once the card's work landed (`Shipped` in board.ts): the commit it landed with and its
   * pull request. Kept after its worker is done: a workstream whose plan doc keeps it open is
   * planned again once the read checkout holds that commit.
   */
  shipped: string | null;
  /** When Seismic stopped the app in the card's workstation while the card waited (Parking); gone once its worker heard so. */
  parked: string | null;
  /** JSON: the owner's comments on places in the demo video Seismic holds back while they watch (event ids, `Item.held`). */
  held: string | null;
  /** 1 once the owner decided the card (an idea or a task of theirs) becomes a plan: its worker writes the plan doc, and the plan takes its place. */
  becomes_plan: number;
  /** JSON, a Question card (and an idea that was one): the thread of looked-up answers it holds (`StoredThread` in board.ts). */
  thread: string | null;
  /** JSON, while the owner or usage limit has paused the card's agent: for a worker what came for it meanwhile (`PausedState` in workers.ts), `{}` for an idea's or a Question card's agent, which keep what waits for them with the idea or the thread. */
  paused: string | null;
  /** Since when (ISO) the owner has asked the card's agent to pause once it has brought its work to a safe point; null once it paused, went on or stopped. */
  pausing: string | null;
  /** JSON: the owner's words Seismic holds for the card's worker until it takes them in, at its next tool step or turn (`Unheard` in workers.ts). */
  unheard: string | null;
  /** The address its worker opens the app in the card's workstation at, while it runs (`app_running`); gone once Seismic stops the app or the workstation goes. */
  app: string | null;
  /** Since when the card waits for the owner (`needsYou`), kept while it does; null while it does not. */
  waiting_since: string | null;
  /** JSON, while the card is snoozed until a point in time (`Snooze`): Seismic wakes it then. */
  snoozed: string | null;
  /** When the owner moved the card into the parking lot (ISO): off the canvas, listed in the Agents sheet's Parked tab; null while it is on the canvas. */
  parking_lot: string | null;
  /** JSON: the files its worker named as the result at its latest handover that named any (`CardFile[]`). */
  files: string | null;
  /** JSON, plans only: which workstream builds on which, as the Koordinator read it from the plan doc (`StoredDeps` in board.ts). */
  deps: string | null;
  /** 1 while the owner has a plan folded to its head: its workstreams are not shown on the project. */
  collapsed: number;
  /**
   * The clone (`ssh://<host>/…` on a host) that holds the newest state of the card's branch since
   * the owner took its workstation from it, its uncommitted work in a commit of Seismic's on top; gone
   * once the card works in a clone again, which takes the branch from there.
   */
  kept_in: string | null;
  /**
   * JSON: a repository to create for the card before work begins (`NewRepo`); once Seismic made it,
   * `{ path, project, made: true }`, so its worker hears that the repository is new.
   */
  new_repo: string | null;
  /** What the card's worker last heard of its demo's page (`PageHeard` in workers.ts), so it hears of a change with its next step. */
  page_heard: string | null;
  /** The priority the owner gave the card (`Priority`), null while none. */
  priority: string | null;
  /** The card's category (`Category`), null while none. */
  category: string | null;
  /** The card's sub-category (`Subcategory`), null while none. */
  subcategory: string | null;
  /** The card's complexity (`Complexity`), null while none. */
  complexity: number | null;
  /** JSON: the labels Seismic set as its suggestion and the owner has not touched since (`Label[]`); null while none. */
  suggested_labels: string | null;
  /** JSON: the labels the owner has set, to a value or to none (`Label[]`): Seismic suggests none of them again. Null while none. */
  owner_labels: string | null;
  /** The card's code in addresses (`/p/<project>/c/<code>`): the start of its id's hex digits, unique among all cards (`SHORT`). */
  short: string;
}

/** A card to store; without `canvas_id` it goes on its plan's canvas (a workstream), else on the project's `main` (`Store.addCards`). */
export type NewRow = Pick<CardRow, 'project_id' | 'kind' | 'x' | 'y'> &
  Partial<Pick<CardRow, 'canvas_id' | 'state' | 'title' | 'body' | 'parent_id' | 'plan_ref' | 'from_id' | 'repo' | 'idea' | 'prototype_of' | 'prototype' | 'images' | 'retro' | 'proposal' | 'group_id'>>;

/** What `Cards.update` may change on a card: all but what is set once at its creation, and its times. */
export type RowUpdate = Partial<Omit<CardRow, 'id' | 'project_id' | 'canvas_id' | 'parent_id' | 'plan_ref' | 'prototype_of' | 'retro' | 'created_at' | 'updated_at'>>;

/** What a new card is stored with: the fields of `NewRow`, its own and its times. */
const NEW_FIELDS = ['id', 'short', 'project_id', 'canvas_id', 'kind', 'state', 'title', 'body', 'x', 'y', 'parent_id', 'plan_ref', 'from_id', 'repo', 'idea', 'prototype_of', 'prototype', 'images', 'retro', 'proposal', 'group_id', 'created_at', 'updated_at'] as const;

/** The row as stored, as `CardRow` has it. */
const row = stored(cards);
/** Each column's key in `cards` by its name in the database. */
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

const open = (projectId: string) => and(eq(cards.projectId, projectId), isNull(cards.deletedAt));

/** The cards' queries (`Store.cards`): rows as stored, `CardRow`. */
export class Cards {
  private readonly byId;
  private readonly taken;

  constructor(private readonly db: Db) {
    this.byId = db.select(row).from(cards).where(eq(cards.id, sql.placeholder('id'))).prepare();
    this.taken = db.select({ one: sql`1` }).from(cards).where(eq(cards.short, sql.placeholder('short'))).prepare();
  }

  get(id: string): CardRow | null {
    return (this.byId.get({ id }) as CardRow | undefined) ?? null;
  }

  /** The rows of these cards, deleted or archived ones too. */
  byIds(ids: string[]): CardRow[] {
    if (!ids.length) return [];
    return this.db.select(row).from(cards).where(inArray(cards.id, sql`(SELECT value FROM json_each(${JSON.stringify(ids)}))`)).all() as unknown as CardRow[];
  }

  /** Every card on the project: not deleted, not archived. */
  onProject(projectId: string): CardRow[] {
    return this.db.select(row).from(cards).where(and(open(projectId), isNull(cards.archivedAt))).all() as unknown as CardRow[];
  }

  /** The project's cards, archived ones too, that were ever shared or are about to be. */
  shared(projectId: string): CardRow[] {
    return this.db.select(row).from(cards).where(and(open(projectId), isNotNull(cards.share))).all() as unknown as CardRow[];
  }

  /** The project's archive, the most recently archived first. */
  archived(projectId: string): CardRow[] {
    return this.db.select(row).from(cards).where(and(open(projectId), isNotNull(cards.archivedAt))).orderBy(desc(cards.archivedAt), desc(cards.createdAt)).all() as unknown as CardRow[];
  }

  /** The project's plans, on the project or archived. */
  plans(projectId: string): CardRow[] {
    return this.db.select(row).from(cards).where(and(open(projectId), eq(cards.kind, 'plan'), isNotNull(cards.planRef))).all() as unknown as CardRow[];
  }

  /** The cards whose landed work added plan docs, on the project or archived. */
  withPlanDocs(projectId: string): CardRow[] {
    return this.db.select(row).from(cards).where(and(open(projectId), isNotNull(cards.planDocs))).all() as unknown as CardRow[];
  }

  /** The project's prototypes, on the project or archived, the oldest first: which they are, without the rest of their rows. */
  prototypes(projectId: string): Pick<CardRow, 'id' | 'prototype_of' | 'archived_at'>[] {
    return this.db
      .select({ id: cards.id, prototype_of: cards.prototypeOf, archived_at: cards.archivedAt })
      .from(cards)
      .where(and(open(projectId), isNotNull(cards.prototypeOf)))
      .orderBy(asc(cards.createdAt), sql`rowid`)
      .all();
  }

  /** The workstreams of the given plans. */
  children(parentIds: string[]): CardRow[] {
    if (!parentIds.length) return [];
    return this.db.select(row).from(cards).where(and(isNull(cards.deletedAt), inArray(cards.parentId, parentIds))).all() as unknown as CardRow[];
  }

  /** The proposals an agent made from a card, deleted and archived ones too, oldest first. */
  proposalsFrom(projectId: string, fromId: string): CardRow[] {
    return this.db
      .select(row)
      .from(cards)
      .where(and(eq(cards.projectId, projectId), eq(cards.fromId, fromId), isNotNull(cards.proposal)))
      .orderBy(asc(cards.createdAt), sql`rowid`)
      .all() as unknown as CardRow[];
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

  /** How many cards are on the canvas: on the project, not archived or deleted. */
  onCanvas(canvasId: string): number {
    return this.db.select({ n: count() }).from(cards).where(and(eq(cards.canvasId, canvasId), isNull(cards.deletedAt), isNull(cards.archivedAt))).get()!.n;
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

  /** Since when each of the project's cards waits for the owner, for those that do. */
  waitingSince(projectId: string): Map<string, string> {
    const rows = this.db.select({ id: cards.id, since: cards.waitingSince }).from(cards).where(and(eq(cards.projectId, projectId), isNotNull(cards.waitingSince))).all();
    return new Map(rows.map((r) => [r.id, r.since!]));
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
    // a proposal its agent withdrew went without the owner
    return this.db
      .select({ at: sql<string>`${cards.deletedAt}`, title: sql<string>`${cards.title}`, state: sql<CardState>`COALESCE(${cards.state}, 'planned')` })
      .from(cards)
      .where(
        and(
          eq(cards.projectId, projectId),
          isNull(cards.planRef),
          sql`${cards.deletedAt} > ${since}`,
          sql`NOT (${cards.state} = 'proposal' AND json_extract(${cards.proposal}, '$.superseded') IS NOT NULL)`,
        ),
      )
      .orderBy(cards.deletedAt)
      .all();
  }

  /** Stores new cards, each on the canvas it names, under a code of its own (`SHORT`). */
  insert(rows: (NewRow & { canvas_id: string })[]): CardRow[] {
    const ids = atomic(this.db, () =>
      rows.map((r) => {
        const id = crypto.randomUUID();
        // the shortest start of its hex digits no other card has as its code; the whole of them is its own
        const hex = id.replaceAll('-', '');
        let n = SHORT;
        while (n < hex.length && this.taken.get({ short: hex.slice(0, n) })) n++;
        const at = now();
        const fields: Record<string, unknown> = { ...r, id, short: hex.slice(0, n), created_at: at, updated_at: at };
        this.db.insert(cards).values(asStored(Object.fromEntries(NEW_FIELDS.map((f) => [f, fields[f]]))) as unknown as typeof cards.$inferInsert).run();
        return id;
      }),
    );
    return ids.map((id) => this.get(id)!);
  }

  update(id: string, fields: RowUpdate) {
    if (!Object.keys(fields).length) return;
    this.db.update(cards).set({ ...asStored(fields), updatedAt: now() }).where(eq(cards.id, id)).run();
  }

  /** Notes since when a card waits for the owner, or that it no longer does (`null`); the card counts as unchanged. */
  setWaitingSince(id: string, since: string | null) {
    this.db.update(cards).set({ waitingSince: since }).where(eq(cards.id, id)).run();
  }

  /** Puts the card on another workstream (`planRef`, in plan `parentId`), or takes it out of its plan (both null). */
  replan(id: string, planRef: string | null, parentId: string | null) {
    this.db.update(cards).set({ planRef, parentId, updatedAt: now() }).where(eq(cards.id, id)).run();
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

  /** Every card on canvas `from`, archived and deleted ones too, goes to canvas `into`. */
  moveCanvas(from: string, into: string) {
    this.db.update(cards).set({ canvasId: into }).where(eq(cards.canvasId, from)).run();
  }

  /** The cards of group `from` go into group `into`. */
  moveGroup(from: string, into: string) {
    this.db.update(cards).set({ groupId: into }).where(eq(cards.groupId, from)).run();
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
