import { inArray, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { stored } from './models/common';
import * as t from './models/schema';
import type { Store } from './store';

/** The tables that hold a project's records, under their names in the database, by its id or its cards'. */
const BY_PROJECT: [string, SQLiteTable & { projectId: SQLiteColumn }][] = [
  ['canvases', t.canvases],
  ['groups', t.groups],
  ['cards', t.cards],
  ['chats', t.chats],
  ['workstations', t.workstations],
  ['decisions', t.decisions],
  ['settings', t.settings],
  ['preferences', t.preferences],
  ['talk', t.talk],
  ['friction', t.friction],
  ['commands', t.commands],
  ['setting_proposals', t.settingProposals],
  ['feedback', t.feedback],
];
const BY_CARD: [string, SQLiteTable & { cardId: SQLiteColumn }][] = [
  ['events', t.events],
  ['card_ideas', t.cardIdeas],
  ['agent_runs', t.agentRuns],
  ['folder_cards', t.folderCards],
];

/** All records owned by the selected projects, including archived and deleted cards, each row as stored. */
export function projectData(store: Store, ids: string[]) {
  const db = store.orm;
  const names = db
    .select(stored(t.projects))
    .from(t.projects)
    .where(inArray(t.projects.id, sql`(SELECT value FROM json_each(${JSON.stringify(ids)}))`))
    .orderBy(t.projects.name, t.projects.id)
    .all() as { id: string; name: string; created_at: string }[];
  const selected = sql`(SELECT value FROM json_each(${JSON.stringify(names.map((c) => c.id))}))`;
  const tables: Record<string, Record<string, unknown>[]> = { projects: names };
  for (const [name, table] of BY_PROJECT) tables[name] = db.select(stored(table)).from(table).where(inArray(table.projectId, selected)).all();
  const cards = db.select({ id: t.cards.id }).from(t.cards).where(inArray(t.cards.projectId, selected));
  for (const [name, table] of BY_CARD) tables[name] = db.select(stored(table)).from(table).where(inArray(table.cardId, cards)).all();
  return { format: 'obeya-project-export', version: 1, exportedAt: new Date().toISOString(), tables };
}

export function projectCsv(data: ReturnType<typeof projectData>): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = ['table,project_id,data'];
  const cardProjects = new Map(data.tables.cards?.map((row) => [row.id, row.project_id]) ?? []);
  for (const [table, rows] of Object.entries(data.tables)) for (const row of rows) {
    const project = String(row.project_id ?? (table === 'projects' ? row.id : cardProjects.get(row.card_id)) ?? '');
    lines.push([table, project, JSON.stringify(row)].map(quote).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
