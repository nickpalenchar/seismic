// Starts the database and configuration code on a copy of an existing Seismic home (from before
// projects were canvases, say) and reports what it made of it, without running a server or agents:
//   bun scripts/check-home-migration.ts [home]      (default: ~/.obeya; the home itself is never written)
import { cpSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { Store } from '../src/server/db';
import { adoptOldConfig, CONFIG_FILE, readConfigFile } from '../src/server/config';
import { projectDefaults } from '../src/server/settings';

const source = process.argv[2] ?? join(homedir(), '.obeya');
const home = mkdtempSync(join(tmpdir(), 'obeya-home-copy-'));
for (const f of readdirSync(source)) if (/^(obeya\.db.*|[a-z-]+\.json)$/.test(f)) cpSync(join(source, f), join(home, f));

const count = (db: Database, sql: string) => (db.query(sql).get() as { n: number }).n;
const raw = new Database(join(home, 'obeya.db'));
const cards = count(raw, 'SELECT count(*) n FROM cards');
const before = (raw.query('PRAGMA user_version').get() as { user_version: number }).user_version;
raw.close();
const store = new Store(join(home, 'obeya.db'));
const after = (store.db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
const left = store.db.query("SELECT name FROM sqlite_master WHERE sql LIKE '%anvas%' OR name LIKE '%anvas%'").all();
console.log(`schema ${before} -> ${after}; cards ${cards} -> ${count(store.db, 'SELECT count(*) n FROM cards WHERE project_id IS NOT NULL')} with a project`);
console.log(`projects: ${store.db.query('SELECT id FROM projects').all().map((p) => (p as { id: string }).id).join(', ')}`);
console.log(`names with "canvas" left in the schema: ${left.length}; foreign key violations: ${store.db.query('PRAGMA foreign_key_check').all().length}`);
adoptOldConfig(home);
console.log(`${CONFIG_FILE}: ${existsSync(join(home, CONFIG_FILE)) ? `${readConfigFile(join(home, CONFIG_FILE)).length} projects read` : 'none'}`);
console.log(`defaults archive: ${projectDefaults(home).archive}`);
