import { sql } from 'drizzle-orm';
import { type AnySQLiteColumn, index, integer, real, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { CardFile } from '../../../core/files';
import type { Category, Complexity, Label, Priority, Subcategory } from '../../../core/labels';
import type { PlanDoc } from '../../../core/plan-doc';
import type { AgentSetting, CardKind, CardState, Need, Proposal, Queue, Snooze } from '../../../core/types';
import type { PrState, Shipped, StoredCodeReview, StoredContribution, StoredDemo, StoredDeps, StoredIdea, StoredNewRepo, StoredPrototype, StoredShare, StoredThread } from '../../board';
import type { Scope } from '../../koordinator';
import type { LandedState, PageHeard, PausedState, Unheard } from '../../workers';
import { groups } from '../groups';
import { projects } from '../projects';

/** Every card, whatever its kind; what each column holds is described on `CardRow` (db.ts). */
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
