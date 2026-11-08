import type { Store } from './db';

/** All records owned by the selected projects, including archived and deleted cards. */
export function projectData(store: Store, ids: string[]) {
  const db = store.db;
  const names = db.query('SELECT * FROM projects WHERE id IN (SELECT value FROM json_each($ids)) ORDER BY name, id').all({ ids: JSON.stringify(ids) }) as { id: string; name: string; created_at: string }[];
  const selected = JSON.stringify(names.map((c) => c.id));
  const byProject = ['canvases', 'groups', 'cards', 'chats', 'workstations', 'decisions', 'settings', 'preferences', 'talk', 'friction', 'commands', 'setting_proposals', 'feedback'];
  const byCard = ['events', 'agent_runs', 'folder_cards'];
  const tables: Record<string, Record<string, unknown>[]> = { projects: names };
  for (const table of byProject) {
    if (!tableExists(store, table)) continue;
    tables[table] = db.query(`SELECT * FROM ${table} WHERE project_id IN (SELECT value FROM json_each($ids))`).all({ ids: selected }) as Record<string, unknown>[];
  }
  for (const table of byCard) {
    if (!tableExists(store, table)) continue;
    tables[table] = db.query(`SELECT * FROM ${table} WHERE card_id IN (SELECT id FROM cards WHERE project_id IN (SELECT value FROM json_each($ids)))`).all({ ids: selected }) as Record<string, unknown>[];
  }
  return { format: 'obeya-project-export', version: 1, exportedAt: new Date().toISOString(), tables };
}

function tableExists(store: Store, name: string) {
  return !!store.db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name").get({ name });
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
