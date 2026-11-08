import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CardEvent } from '../core/types';
import { MIGRATIONS, NewerDatabase, OlderDatabase, RELEASED, SHORT } from './db';
import { Store } from './store';

const version = (path: string) => {
  const db = new Database(path);
  const { user_version } = db.query('PRAGMA user_version').get() as { user_version: number };
  db.close();
  return user_version;
};

function withPath(f: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-db-'));
  try {
    f(join(dir, 'obeya.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The columns of `cards` that moved into the tables of a card's parts, as they were added to it. */
const MOVED = [
  'pr TEXT', 'demo TEXT', 'idea TEXT', 'prototype_of TEXT REFERENCES cards(id)', 'plan TEXT', 'plan_docs TEXT', 'prototype TEXT',
  'built_on TEXT REFERENCES cards(id)', 'share TEXT', 'proposal TEXT', 'held TEXT', 'becomes_plan INTEGER NOT NULL DEFAULT 0', 'paused TEXT',
  'demos TEXT', 'snoozed TEXT', 'files TEXT', 'deps TEXT', 'collapsed INTEGER NOT NULL DEFAULT 0', 'contribution TEXT', 'new_repo TEXT',
  'page_heard TEXT', 'pausing TEXT', 'priority TEXT', 'category TEXT', 'subcategory TEXT', 'complexity INTEGER', 'suggested_labels TEXT',
  'owner_labels TEXT', 'code_review TEXT', 'parking_lot TEXT', 'hold TEXT',
];

/** The database as it was before the columns that moved into the tables of a card's parts were dropped from `cards`. */
function withMovedColumns(db: Database) {
  if (db.query("SELECT 1 FROM pragma_table_info('cards') WHERE name = 'hold'").get()) return;
  for (const column of MOVED) db.run(`ALTER TABLE cards ADD COLUMN ${column}`);
  db.run('CREATE INDEX cards_prototypes ON cards (project_id, created_at) WHERE deleted_at IS NULL AND prototype_of IS NOT NULL');
}

/** The database as it was before a card's review, demo and plan parts, labels and hold had tables of their own. */
function withoutParts(db: Database) {
  withMovedColumns(db);
  if (!db.query("SELECT 1 FROM sqlite_master WHERE name = 'card_holds'").get()) return;
  for (const t of ['card_reviews', 'card_demos', 'card_earlier_demos', 'card_plans', 'card_labels', 'card_holds']) db.run(`DROP TABLE ${t}`);
  db.run('CREATE INDEX cards_plan_docs ON cards (project_id) WHERE deleted_at IS NULL AND plan_docs IS NOT NULL');
  db.run('CREATE INDEX cards_shared ON cards (project_id) WHERE deleted_at IS NULL AND share IS NOT NULL');
}

/** The database as it was before projects had canvases: the migration that brought them undone, and the ones after it. */
function withoutCanvases(db: Database) {
  withoutParts(db);
  db.run('DROP TABLE card_ideas');
  db.run('ALTER TABLE cards DROP COLUMN hold');
  db.run('ALTER TABLE cards DROP COLUMN parking_lot');
  db.run('DROP INDEX cards_canvas; ALTER TABLE cards DROP COLUMN canvas_id; ALTER TABLE groups DROP COLUMN canvas_id; DROP TABLE canvases');
}

/** The database as it was while projects were canvases: the migrations that renamed them and brought canvases undone, for tests that rebuild an older one. */
function asCanvases(db: Database) {
  db.run('DROP TABLE activity');
  withoutCanvases(db);
  for (const { name } of db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    if ((db.query(`PRAGMA table_info(${name})`).all() as { name: string }[]).some((c) => c.name === 'project_id')) db.run(`ALTER TABLE ${name} RENAME COLUMN project_id TO canvas_id`);
  db.run('ALTER TABLE projects RENAME TO canvases');
  if (db.query("SELECT 1 FROM sqlite_master WHERE name = 'chats_project'").get()) db.run('DROP INDEX chats_project; CREATE INDEX chats_canvas ON chats (canvas_id, opened)');
}

test('a database a newer Seismic wrote is left alone, not opened', () =>
  withPath((path) => {
    new Store(path).db.close();
    const newer = new Database(path);
    newer.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.length + 1}`);
    newer.close();
    expect(() => new Store(path)).toThrow(NewerDatabase);
    expect(version(path)).toBe(RELEASED + MIGRATIONS.length + 1);
  }));

test('a database an Seismic before the release left behind it is left alone, not opened', () =>
  withPath((path) => {
    const old = new Database(path);
    old.run('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)');
    old.run(`PRAGMA user_version = ${RELEASED - 1}`);
    old.close();
    expect(() => new Store(path)).toThrow(OlderDatabase);
    expect(version(path)).toBe(RELEASED - 1);
  }));

test('what an Seismic before the release kept in earlier shapes is in today’s', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'C');
    const [video, answered, held, plan] = s.addCards([
      { project_id: 'c', kind: 'task', state: 'waiting', x: 0, y: 0 },
      { project_id: 'c', kind: 'task', state: 'waiting', x: 0, y: 1 },
      { project_id: 'c', kind: 'task', state: 'done', x: 0, y: 2 },
      { project_id: 'c', kind: 'project' as 'plan', plan_ref: 'docs/plan/gone.md', title: 'Gone', x: 0, y: 3 },
    ]);
    const log = (cardId: string, kind: CardEvent['kind'], author: CardEvent['author'], text: string) => s.events.add({ cardId, kind, author, text });
    const first = log(answered!.id, 'review', 'worker', 'Done.');
    log(answered!.id, 'answer', 'owner', 'Yes');
    log(answered!.id, 'review', 'worker', 'Done again.');
    const paused = log(video!.id, 'state', 'owner', 'Paused. The agent goes on when you click “Resume” or write to it.');
    withMovedColumns(s.db);
    const set = (id: string, column: string, value: object) => s.db.run(`UPDATE cards SET ${column} = ? WHERE id = ?`, [JSON.stringify(value), id]);
    set(video!.id, 'demo', { dir: '/d', chapters: [], answering: true });
    set(answered!.id, 'demo', { kind: 'video', dir: '/d', chapters: [], question: 'Q?', answer: 'Yes' });
    set(held!.id, 'share', { slug: 's', state: 'pending', dir: '/d', shown: { title: 'T', text: '', chapters: [] } });
    s.settings.set('c', 'work_retro_since:app', '2026-10-01T00:00:00Z');
    // the schema as released: without the columns and indexes later migrations add
    withoutParts(s.db);
    for (const index of ['cards_open', 'cards_plan_docs', 'cards_prototypes', 'cards_waiting', 'cards_shared']) s.db.run(`DROP INDEX ${index}`);
    s.db.run('ALTER TABLE talk DROP COLUMN reply_to');
    s.db.run('ALTER TABLE cards DROP COLUMN app');
    s.db.run('DROP TABLE devices');
    s.db.run('ALTER TABLE talk DROP COLUMN wish');
    s.db.run('ALTER TABLE events DROP COLUMN wish');
    s.db.run('ALTER TABLE cards DROP COLUMN demos');
    s.db.run('ALTER TABLE cards DROP COLUMN waiting_since');
    s.db.run('DROP TABLE trusted_commands');
    s.db.run('ALTER TABLE talk DROP COLUMN held');
    s.db.run('ALTER TABLE cards DROP COLUMN snoozed');
    s.db.run('ALTER TABLE talk DROP COLUMN waits');
    s.db.run('ALTER TABLE talk DROP COLUMN after_wait');
    s.db.run('DROP TABLE folder_cards');
    s.db.run('ALTER TABLE cards DROP COLUMN files');
    s.db.run('ALTER TABLE cards DROP COLUMN deps');
    s.db.run('ALTER TABLE cards DROP COLUMN collapsed');
    s.db.run('ALTER TABLE talk DROP COLUMN asked_in');
    s.db.run('ALTER TABLE events DROP COLUMN reply');
    s.db.run('ALTER TABLE cards DROP COLUMN kept_in');
    s.db.run('ALTER TABLE cards DROP COLUMN contribution');
    s.db.run('ALTER TABLE cards DROP COLUMN new_repo');
    s.db.run('ALTER TABLE talk DROP COLUMN moved');
    s.db.run('ALTER TABLE cards DROP COLUMN page_heard');
    s.db.run('ALTER TABLE events DROP COLUMN forwarded');
    s.db.run('ALTER TABLE cards DROP COLUMN pausing');
    s.db.run('ALTER TABLE talk DROP COLUMN then_step');
    s.db.run('ALTER TABLE talk DROP COLUMN after_answer');
    s.db.run('ALTER TABLE cards DROP COLUMN agent_setting');
    s.db.run('ALTER TABLE events DROP COLUMN agent');
    s.db.run('ALTER TABLE talk DROP COLUMN reply_agent');
    s.db.run('ALTER TABLE talk DROP COLUMN answer_agent');
    s.db.run('DROP INDEX cards_short');
    s.db.run('ALTER TABLE cards DROP COLUMN short');
    s.db.run('ALTER TABLE events DROP COLUMN token');
    s.db.run('ALTER TABLE talk DROP COLUMN then_place');
    s.db.run('ALTER TABLE events DROP COLUMN made');
    s.db.run('DROP TABLE agent_runs');
    s.db.run('DROP TABLE feedback');
    s.db.run('ALTER TABLE cards DROP COLUMN priority');
    for (const c of ['category', 'subcategory', 'complexity', 'suggested_labels', 'owner_labels', 'code_review']) s.db.run(`ALTER TABLE cards DROP COLUMN ${c}`);
    s.db.run('DROP INDEX talk_chat');
    s.db.run('ALTER TABLE talk DROP COLUMN chat');
    s.db.run('DROP TABLE chats');
    s.decisions.add({ projectId: 'c', planId: plan!.id, cardId: plan!.id, question: 'q', answer: 'a', by: 'plan' });
    s.db.run("UPDATE decisions SET by = 'project'");
    asCanvases(s.db);
    s.db.run('ALTER TABLE cards RENAME COLUMN becomes_plan TO becomes_project; ALTER TABLE decisions RENAME COLUMN plan_id TO project_id');
    s.db.run('ALTER TABLE workstations RENAME TO workspaces; ALTER TABLE cards RENAME COLUMN workstation TO workspace');
    s.db.run("UPDATE cards SET kind = 'project' WHERE kind = 'plan'");
    s.db.query('INSERT INTO workspaces (path, canvas_id, card_id) VALUES ($path, $c, $card)').run({ path: '/w/1', c: 'c', card: video!.id });
    s.db.query(`UPDATE cards SET workspace = '/w/1', queue = '{"since":"2026-01-01","workspace":"dirty","begun":true}' WHERE id = $id`).run({ id: video!.id });
    s.db.run(`PRAGMA user_version = ${RELEASED}`);
    s.db.close();

    const after = new Store(path);
    expect(after.decisions.of('c', plan!.id)[0]!.by).toBe('plan');
    expect(after.cards.get(video!.id)!.demo!.latest!).toEqual({ dir: '/d', chapters: [], kind: 'video' });
    expect(JSON.parse(after.cards.get(video!.id)!.detail!)).toEqual({ answering: true });
    expect(after.events.of(video!.id).find((e) => e.id === paused.id)!.text).toBe('Paused.');
    expect(after.cards.get(answered!.id)!.demo!.latest!.handover).toBe(first.id);
    expect(after.cards.get(held!.id)!.demo!.share!).toMatchObject({ state: 'publishing', shown: { kind: 'video' } });
    expect(after.cards.get(plan!.id)!.kind).toBe('plan');
    expect(after.cards.get(plan!.id)!.plan!.doc!).toEqual({ file: 'docs/plan/gone.md', title: 'Gone', goal: '', workstreams: [], markdown: '' });
    expect(after.settings.get('c', 'work_retro_runs:app')).toBe('3');
    expect(after.cards.get(video!.id)!.agent_setting).toBeNull();
    expect(after.cards.get(video!.id)!.workstation).toBe('/w/1');
    expect(JSON.parse(after.cards.get(video!.id)!.queue!)).toEqual({ since: '2026-01-01', workstation: 'dirty', begun: true });
    expect(after.workstations.of('c')).toEqual([{ path: '/w/1', card_id: video!.id }]);
    expect(after.cards.get(video!.id)!.short).toBe(video!.id.replaceAll('-', '').slice(0, SHORT));
    after.db.close();
  }));

test('a card gets the shortest code no other card has: the start of its id, one digit longer for each card that shares it', () => {
  const s = new Store(':memory:');
  s.ensureProject('c', 'C');
  const [a] = s.addCards([{ project_id: 'c', kind: 'task', x: 0, y: 0 }]);
  expect(a!.short).toMatch(new RegExp(`^[0-9a-f]{${SHORT}}$`));
  expect(a!.id.replaceAll('-', '').startsWith(a!.short)).toBe(true);
  // ids that share their start with cards there are already
  const ids = ['abcdef01-0000-4000-8000-000000000001', 'abcdef01-0000-4000-8000-000000000002', 'abcdef01-0000-4000-8000-000000000003'];
  const real = crypto.randomUUID;
  let n = 0;
  crypto.randomUUID = () => ids[n++] as ReturnType<typeof crypto.randomUUID>;
  try {
    expect(s.addCards([0, 1, 2].map((y) => ({ project_id: 'c', kind: 'task' as const, x: 0, y }))).map((r) => r.short)).toEqual(['abcdef', 'abcdef0', 'abcdef01']);
  } finally {
    crypto.randomUUID = real;
  }
});

test('the migration gives the cards there are codes of their own, longer where their ids start alike', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'C');
    const ids = ['12345678-0000-4000-8000-000000000001', '12345678-0000-4000-8000-000000000002', '1234aaaa-0000-4000-8000-000000000003', 'ffffffff-0000-4000-8000-000000000004'];
    const insert = s.db.query("INSERT INTO cards (id, short, project_id, kind, x, y, created_at, updated_at) VALUES ($id, $id, 'c', 'task', 0, 0, '', '')");
    for (const id of ids) insert.run({ id });
    s.db.run('DROP INDEX cards_short');
    s.db.run('ALTER TABLE cards DROP COLUMN short');
    // later migrations run again after it: undo what they added
    s.db.run('ALTER TABLE events DROP COLUMN token');
    withoutParts(s.db);
    for (const index of ['cards_open', 'cards_plan_docs', 'cards_prototypes', 'cards_waiting', 'cards_shared']) s.db.run(`DROP INDEX ${index}`);
    s.db.run('ALTER TABLE talk DROP COLUMN then_place');
    s.db.run('ALTER TABLE events DROP COLUMN made');
    s.db.run('DROP TABLE agent_runs');
    s.db.run('DROP TABLE feedback');
    s.db.run('ALTER TABLE cards DROP COLUMN priority');
    for (const c of ['category', 'subcategory', 'complexity', 'suggested_labels', 'owner_labels', 'code_review']) s.db.run(`ALTER TABLE cards DROP COLUMN ${c}`);
    s.db.run('DROP INDEX talk_chat');
    s.db.run('ALTER TABLE talk DROP COLUMN chat');
    s.db.run('DROP TABLE chats');
    asCanvases(s.db);
    s.db.run('ALTER TABLE cards RENAME COLUMN becomes_plan TO becomes_project; ALTER TABLE decisions RENAME COLUMN plan_id TO project_id');
    s.db.run('ALTER TABLE workstations RENAME TO workspaces; ALTER TABLE cards RENAME COLUMN workstation TO workspace');
    s.db.run("UPDATE cards SET kind = 'project' WHERE kind = 'plan'");
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('ADD COLUMN short'))}`);
    s.db.close();
    const after = new Store(path);
    expect(ids.map((id) => after.cards.get(id)!.short)).toEqual(['12345678000040008000000000000001', '12345678000040008000000000000002', '1234aa', 'ffffff']);
    after.db.close();
  }));

test('the sessions of cards from before runs were recorded: the last as pinned, one for each other identity their agents spoke as', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'C');
    const [pinned, spoke, legacy, mixed, idle] = s.addCards([0, 1, 2, 3, 4].map((y) => ({ project_id: 'c', kind: 'task' as const, x: 0, y })));
    s.cards.update(pinned!.id, { session_id: 's-1', agent_setting: JSON.stringify({ model: 'opus', effort: 'high' }) });
    s.cards.update(spoke!.id, { session_id: 'codex:t-1', agent_setting: JSON.stringify({ model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'gpt-x', effort: 'low' } }) });
    s.events.add({ cardId: spoke!.id, kind: 'say', author: 'worker', text: 'On it.', agent: { harness: 'codex', model: 'gpt-x' } });
    s.events.add({ cardId: spoke!.id, kind: 'say', author: 'koordinator', text: 'Not the worker.', agent: { harness: 'claude', model: 'claude-opus-5-5' } });
    s.cards.update(legacy!.id, { session_id: 'old-claude' });
    const [named] = s.addCards([{ project_id: 'c', kind: 'task', x: 1, y: 0 }]);
    s.cards.update(named!.id, { session_id: 'codex:t-2', agent_setting: JSON.stringify({ model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'gpt-y', effort: 'max' } }) });
    s.cards.update(mixed!.id, { session_id: 's-3', agent_setting: JSON.stringify({ model: 'sonnet', effort: 'low' }) });
    s.events.add({ cardId: mixed!.id, kind: 'say', author: 'worker', text: 'First.', agent: { harness: 'claude', model: 'claude-opus-5-5' } });
    s.events.add({ cardId: mixed!.id, kind: 'say', author: 'worker', text: 'Second.', agent: { harness: 'claude', model: 'claude-sonnet-5-5' } });
    withMovedColumns(s.db);
    s.db.run('DROP TABLE agent_runs');
    s.db.run('DROP TABLE feedback');
    s.db.run('ALTER TABLE cards DROP COLUMN priority');
    for (const c of ['category', 'subcategory', 'complexity', 'suggested_labels', 'owner_labels', 'code_review']) s.db.run(`ALTER TABLE cards DROP COLUMN ${c}`);
    s.db.run('DROP INDEX talk_chat');
    s.db.run('ALTER TABLE talk DROP COLUMN chat');
    s.db.run('DROP TABLE chats');
    asCanvases(s.db);
    s.db.run('ALTER TABLE cards RENAME COLUMN becomes_plan TO becomes_project; ALTER TABLE decisions RENAME COLUMN plan_id TO project_id');
    s.db.run('ALTER TABLE workstations RENAME TO workspaces; ALTER TABLE cards RENAME COLUMN workstation TO workspace');
    s.db.run("UPDATE cards SET kind = 'project' WHERE kind = 'plan'");
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE agent_runs'))}`);
    s.db.close();

    const after = new Store(path);
    const runs = (id: string) => after.agentRuns.of(id).map(({ at: _, ...r }) => r);
    expect(runs(pinned!.id)).toEqual([{ session: 's-1', harness: 'claude', model: null, effort: 'high', requested: 'opus' }]);
    expect(runs(spoke!.id)).toEqual([{ session: 'codex:t-1', harness: 'codex', model: 'gpt-x', effort: 'low', requested: 'gpt-x' }]);
    expect(runs(named!.id)).toEqual([{ session: 'codex:t-2', harness: 'codex', model: 'gpt-y', effort: 'max', requested: 'gpt-y' }]);
    expect(runs(legacy!.id)).toEqual([{ session: 'old-claude', harness: 'claude', model: null, effort: null }]);
    // which of two identities ran with the pinned setting is not known: neither gets it
    expect(runs(mixed!.id)).toEqual([
      { session: 'earlier:claude:claude-opus-5-5', harness: 'claude', model: 'claude-opus-5-5', effort: null },
      { session: 'earlier:claude:claude-sonnet-5-5', harness: 'claude', model: 'claude-sonnet-5-5', effort: null },
    ]);
    expect(runs(idle!.id)).toEqual([]);
    // heard again, a run learns what was unknown and keeps what it knew
    after.agentRuns.record(pinned!.id, 's-1', { harness: 'codex', model: 'claude-opus-5-5', effort: 'low' });
    expect(runs(pinned!.id)).toEqual([{ session: 's-1', harness: 'claude', model: 'claude-opus-5-5', effort: 'high', requested: 'opus' }]);
    after.db.close();
  }));

test('runs and responses survive a restart, one response for each handover', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'C');
    const [card] = s.addCards([{ project_id: 'c', kind: 'task', x: 0, y: 0, title: 'T' }]);
    s.agentRuns.record(card!.id, 's-1', { harness: 'claude', model: 'm', effort: 'high' }, '2026-01-01T00:00:00.000Z');
    const given = { cardId: card!.id, projectId: 'c', handover: 7, title: 'T', attribution: 'single' as const, configs: [{ harness: 'claude' as const, model: 'm', effort: 'high' as const }], answer: { rating: 3 } };
    const first = s.feedback.put(given);
    s.feedback.put({ ...given, configs: [], attribution: 'missing' });
    s.db.close();
    const after = new Store(path);
    expect(after.agentRuns.of(card!.id)).toHaveLength(1);
    expect(after.feedback.of()).toEqual([first]);
    after.db.close();
  }));

test('chats: words go into the one opened last, a new one only once something was said, answers wait unread in theirs', () => {
  const store = new Store(':memory:');
  store.db.run("INSERT INTO projects (id, name, created_at) VALUES ('c', 'Shop', '2026-11-01'), ('d', 'Site', '2026-11-01')");
  const first = store.chats.current('c');
  expect(store.chats.model('c')).toBeUndefined();
  store.chats.setModel('c', 'sonnet');
  expect(store.chats.model('c')).toBe('sonnet');
  expect(store.chats.start('c')).toBe(first);
  const asked = store.addTalk('c', 'wie viele Tests?', '', null, { question: 'wie viele Tests?', about: null });
  const second = store.chats.start('c');
  expect(second).not.toBe(first);
  expect(store.chats.model('c')).toBeUndefined();
  store.addTalk('c', 'hallo', 'Hallo!', null);
  store.addTalk('d', 'anderswo', 'Ja.', null);
  // the answer comes in the chat it was asked in, while the owner talks in another
  store.talk.answer(asked, '42', 'koordinator');
  expect(store.talk.sheet('c', second, 30).map((t) => [t.said, t.chat, !!t.unread])).toEqual([
    ['wie viele Tests?', first, true],
    ['hallo', second, false],
  ]);
  expect(store.chats.list('c').map((x) => [x.title, x.unread])).toEqual([
    ['hallo', undefined],
    ['wie viele Tests?', 1],
  ]);
  // only the chat in view is read
  expect(store.readTalk('c')).toBe(false);
  expect(store.chats.open('c', first)).toBe(true);
  expect(store.chats.current('c')).toBe(first);
  expect(store.chats.model('c')).toBe('sonnet');
  expect(store.readTalk('c')).toBe(true);
  expect(store.chats.open('d', first)).toBe(false);
  expect(store.chats.list().map((x) => x.project).sort()).toEqual(['c', 'c', 'd']);
  // a new chat left without a word in it goes once another is opened
  const empty = store.chats.start('c');
  store.chats.open('c', second);
  expect(store.chats.list('c').map((x) => x.id)).not.toContain(empty);
  expect(store.db.query('SELECT 1 FROM chats WHERE id = $id').get({ id: empty })).toBeNull();
});

test('a chat opened and a new one made in the same millisecond become current in turn', () => {
  const store = new Store(':memory:');
  store.db.run("INSERT INTO projects (id, name, created_at) VALUES ('c', 'Shop', '2026-11-01')");
  const first = store.chats.current('c');
  store.addTalk('c', 'first', '', null);
  const second = store.chats.start('c');
  store.addTalk('c', 'second', '', null);
  store.chats.open('c', first);
  expect(store.chats.current('c')).toBe(first);
  const third = store.chats.start('c');
  expect(store.chats.current('c')).toBe(third);
  expect(third).not.toBe(second);
});

test('what was said before chats existed becomes one chat per project', () =>
  withPath((path) => {
    const store = new Store(path);
    store.db.run("INSERT INTO projects (id, name, created_at) VALUES ('c', 'Shop', '2026-11-01')");
    store.addTalk('c', 'eins', 'A', null);
    store.addTalk('c', 'zwei', 'B', null);
    asCanvases(store.db);
    store.db.run('ALTER TABLE cards RENAME COLUMN becomes_plan TO becomes_project; ALTER TABLE decisions RENAME COLUMN plan_id TO project_id');
    store.db.run('ALTER TABLE workstations RENAME TO workspaces; ALTER TABLE cards RENAME COLUMN workstation TO workspace');
    store.db.run("UPDATE cards SET kind = 'project' WHERE kind = 'plan'");
    store.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE chats'))}`);
    store.db.run('DROP INDEX talk_chat');
    store.db.run('ALTER TABLE talk DROP COLUMN chat');
    store.db.run('DROP TABLE chats');
    store.db.close();
    const again = new Store(path);
    const chats = again.chats.list('c');
    expect(chats.map((x) => x.title)).toEqual(['eins']);
    expect(again.talk.latest('c', 20, false, chats[0]!.id).map((t) => t.said)).toEqual(['eins', 'zwei']);
    again.db.close();
  }));

test('what an Seismic kept while projects were canvases is in today’s names, tables and stored JSON', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    const [card] = s.addCards([{ project_id: 'c', kind: 'task', x: 0, y: 0 }]);
    s.settings.set('c', 'paused', '');
    s.addTalk('c', 'eins', 'A', null);
    s.addMoved('c', { card: card!.id, title: 'T', project: 'd', projectName: 'Site' } as never, 'moved');
    const made = s.events.add({ cardId: card!.id, kind: 'say', author: 'worker', text: 'Made.' });
    asCanvases(s.db);
    s.db.run(`UPDATE talk SET moved = '{"card":"x","title":"T","canvas":"d","canvasName":"Site"}' WHERE moved IS NOT NULL`);
    s.db.run(`UPDATE cards SET new_repo = '{"path":"/r","canvas":true,"by":"owner"}' WHERE id = '${card!.id}'`);
    s.db.query('UPDATE events SET made = $made WHERE id = $id').run({ made: '{"card":"y","title":"U","canvas":"d"}', id: made.id });
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes("ALTER TABLE canvases RENAME TO projects"))}`);
    s.db.close();

    const after = new Store(path);
    expect(after.projects.name('c')).toBe('Shop');
    expect(after.settings.get('c', 'paused')).toBe('');
    expect(after.cards.get(card!.id)!.idea!.newRepo).toEqual({ path: '/r', by: 'owner', project: true });
    expect(after.events.of(card!.id).find((e) => e.id === made.id)!.made).toEqual({ card: 'y', title: 'U', project: 'd' });
    expect(after.talk.latest('c', 20, false).find((t) => t.moved)!.moved).toEqual({ card: 'x', title: 'T', project: 'd', projectName: 'Site' });
    // what names a canvas now is the canvas layer's, which came after
    const layer = (o: { name: string; sql: string | null }) => /^(canvases|canvases_name|cards_canvas|sqlite_autoindex_canvases_1)$/.test(o.name);
    const names = (after.db.query('SELECT name, sql FROM sqlite_master').all() as { name: string; sql: string | null }[])
      .filter((o) => !layer(o) && /canvas/i.test(o.name + (o.sql ?? '').replace(/,\s*`?canvas_id`? text/i, '')));
    expect(names).toEqual([]);
    after.db.close();
  }));

test('the migration gives every project a canvas main holding all its cards and groups', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    s.ensureProject('d', 'Site');
    const [a, plan] = s.addCards([
      { project_id: 'c', kind: 'task', x: 0, y: 0 },
      { project_id: 'c', kind: 'plan', plan_ref: 'docs/plan/a.md', x: 0, y: 0 },
    ]);
    const [kid] = s.addCards([{ project_id: 'c', kind: 'task', parent_id: plan!.id, plan_ref: 'docs/plan/a.md#w1', x: 0, y: 0 }]);
    const [b] = s.addCards([{ project_id: 'd', kind: 'task', x: 0, y: 0 }]);
    s.cards.update(b!.id, { archived_at: '2026-11-01' });
    const g = s.groups.add('c', 'Billing', 200, s.canvases.main('c'));
    s.cards.setGroup([a!.id], g.id);
    s.db.run('DROP TABLE activity');
    withoutCanvases(s.db);
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE canvases'))}`);
    s.db.close();

    const after = new Store(path);
    for (const p of ['c', 'd']) expect(after.canvases.of(p).map((v) => [v.name, v.position])).toEqual([['main', 0]]);
    const main = after.canvases.main('c');
    expect([a, plan, kid].map((r) => after.cards.get(r!.id)!.canvas_id)).toEqual([main, main, main]);
    expect(after.cards.get(b!.id)!.canvas_id).toBe(after.canvases.main('d'));
    expect(after.groups.get(g.id)!.canvasId).toBe(main);
    expect(after.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    after.db.close();
  }));

test('the pause, the pause at a safe point, the usage limit, the snooze and the parking lot move into one hold, with what they held for the worker', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    const rows = s.addCards(Array.from({ length: 8 }, () => ({ project_id: 'c', kind: 'task' as const, x: 0, y: 0 })));
    const [paused, idea, pausing, limit, snoozed, ownerSnoozed, parked, free] = rows.map((r) => r.id);
    withoutParts(s.db);
    s.db.run('DROP TABLE card_ideas');
    s.db.run('ALTER TABLE cards DROP COLUMN hold');
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('ADD `hold`'))}`);
    const set = (id: string, column: string, value: string) => s.db.run(`UPDATE cards SET ${column} = ? WHERE id = ?`, [value, id]);
    const held = [{ text: 'The review came in.', images: ['img-1'] }];
    set(paused!, 'paused', JSON.stringify({ held }));
    set(idea!, 'paused', '{}');
    set(pausing!, 'pausing', '2026-11-08T10:00:00.000Z');
    set(limit!, 'paused', JSON.stringify({ limit: { attempts: 3, until: '2026-11-08T12:00:00.000Z', statusBefore: 'Running the tests' }, held }));
    set(snoozed!, 'snoozed', JSON.stringify({ on: { card: free, title: 'Fix', state: 'done' }, by: 'agent', why: 'Rebase then' }));
    set(ownerSnoozed!, 'snoozed', JSON.stringify({ until: '2026-11-09T08:00:00.000Z', by: 'owner' }));
    set(ownerSnoozed!, 'paused', JSON.stringify({ held }));
    set(parked!, 'parking_lot', '2026-11-08T19:32:19.733Z');
    s.db.close();

    const after = new Store(path);
    const hold = (id: string): unknown => after.cards.get(id)!.hold;
    const since = expect.any(String);
    expect(hold(paused!)).toEqual({ reason: 'paused', since, held });
    expect(hold(idea!)).toEqual({ reason: 'paused', since });
    expect(hold(pausing!)).toEqual({ reason: 'pausing', since: '2026-11-08T10:00:00.000Z' });
    expect(hold(limit!)).toEqual({ reason: 'limit', since, attempts: 3, until: '2026-11-08T12:00:00.000Z', statusBefore: 'Running the tests', held });
    expect(hold(snoozed!)).toEqual({ reason: 'snoozed', since, on: { card: free, title: 'Fix', state: 'done' }, by: 'agent', why: 'Rebase then' });
    expect(hold(ownerSnoozed!)).toEqual({ reason: 'snoozed', since, until: '2026-11-09T08:00:00.000Z', by: 'owner', held });
    expect(hold(parked!)).toEqual({ reason: 'parkingLot', since: '2026-11-08T19:32:19.733Z' });
    expect(hold(free!)).toBeNull();
    after.db.close();
  }));

test('an idea, a prototype, a proposal, a card built on a prototype, one that becomes a plan and one for a new repository move into the ideas table', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    const rows = s.addCards(Array.from({ length: 7 }, () => ({ project_id: 'c', kind: 'task' as const, x: 0, y: 0 })));
    const [idea, prototype, proposed, built, plan, repo, plain] = rows.map((r) => r.id);
    withoutParts(s.db);
    s.db.run('DROP TABLE card_ideas');
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE `card_ideas`'))}`);
    const set = (id: string, column: string, value: string | number) => s.db.run(`UPDATE cards SET ${column} = ? WHERE id = ?`, [value, id]);
    set(idea!, 'idea', JSON.stringify({ status: 'open', brief: 'A shop', yourTurn: true }));
    set(prototype!, 'prototype_of', idea!);
    set(prototype!, 'prototype', JSON.stringify({ variant: 'Plain HTML', proposal: 'Build on me' }));
    set(proposed!, 'proposal', JSON.stringify({ reason: 'Tests fail', questions: [] }));
    set(built!, 'built_on', prototype!);
    set(plan!, 'becomes_plan', 1);
    set(repo!, 'new_repo', JSON.stringify({ path: '/r', project: true, by: 'owner' }));
    s.db.close();

    const after = new Store(path);
    const idea_ = (id: string) => after.cards.get(id)!.idea;
    const none = { discussion: null, prototypeOf: null, prototype: null, proposal: null, builtOn: null, becomesPlan: false, newRepo: null };
    expect(idea_(idea!)).toEqual({ ...none, discussion: { status: 'open', brief: 'A shop', yourTurn: true } });
    expect(idea_(prototype!)).toEqual({ ...none, prototypeOf: idea!, prototype: { variant: 'Plain HTML', proposal: 'Build on me' } });
    expect(idea_(proposed!)).toEqual({ ...none, proposal: { reason: 'Tests fail', questions: [] } });
    expect(idea_(built!)).toEqual({ ...none, builtOn: prototype! });
    expect(idea_(plan!)).toEqual({ ...none, becomesPlan: true });
    expect(idea_(repo!)).toEqual({ ...none, newRepo: { path: '/r', project: true, by: 'owner' } });
    expect(idea_(plain!)).toBeNull();
    expect(after.ideas.prototypes('c')).toEqual([{ id: prototype!, prototype_of: idea!, archived_at: null }]);
    expect(after.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    after.db.close();
  }));

test('a card gets its idea part once any of it is set, and loses it once all of it is cleared', () => {
  const s = new Store(':memory:');
  s.ensureProject('c', 'Shop');
  const [card] = s.addCards([{ project_id: 'c', kind: 'task', x: 0, y: 0, idea: { proposal: { questions: [] } } }]);
  expect(card!.idea?.proposal).toEqual({ questions: [] });
  s.updateCard(card!.id, { idea: { becomesPlan: true } });
  expect(s.cards.get(card!.id)!.idea).toMatchObject({ proposal: { questions: [] }, becomesPlan: true });
  expect(s.cards.proposalsFrom('c', card!.id)).toEqual([]);
  s.updateCard(card!.id, { idea: { proposal: null, becomesPlan: false } });
  expect(s.cards.get(card!.id)!.idea).toBeNull();
  expect(s.db.query('SELECT COUNT(*) AS n FROM card_ideas').get()).toEqual({ n: 0 });
});

test('a pull request, a demo with earlier ones, a plan, labels and a hold move into tables of their own', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    const [reviewed, demoed, planned, labelled, held, plain] = s.addCards(Array.from({ length: 6 }, () => ({ project_id: 'c', kind: 'task' as const, x: 0, y: 0 }))).map((r) => r.id);
    withoutParts(s.db);
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE \`card_reviews\`'))}`);
    const set = (id: string, column: string, value: unknown) => s.db.run(`UPDATE cards SET ${column} = ? WHERE id = ?`, [typeof value === 'object' ? JSON.stringify(value) : (value as string | number), id]);
    const pr = { url: 'https://github.com/a/b/pull/1', number: 1, seen: [], reported: [] };
    set(reviewed!, 'pr', pr);
    set(reviewed!, 'code_review', { mode: 'auto', handover: 3 });
    const demo = (dir: string) => ({ kind: 'video', dir, chapters: [] });
    set(demoed!, 'demo', demo('/c'));
    set(demoed!, 'demos', [demo('/a'), demo('/b')]);
    set(demoed!, 'share', { slug: 'csv' });
    set(demoed!, 'files', [{ path: 'r.md', caption: 'Report' }]);
    set(demoed!, 'held', [{ id: 4 }]);
    set(planned!, 'plan', { file: 'docs/plan/a.md', title: 'A' });
    set(planned!, 'collapsed', 1);
    set(labelled!, 'category', 'frontend');
    set(labelled!, 'complexity', 3);
    set(labelled!, 'priority', 'high');
    set(labelled!, 'suggested_labels', ['category', 'subcategory']);
    set(labelled!, 'owner_labels', ['priority', 'subcategory']);
    set(held!, 'hold', { reason: 'snoozed', since: '2026-11-08T10:00:00.000Z', until: '2026-11-09T08:00:00.000Z', by: 'owner' });
    s.db.close();

    const after = new Store(path);
    const row = (id: string): Record<string, unknown> => after.cards.get(id)! as unknown as Record<string, unknown>;
    expect(row(reviewed!).review).toEqual({ pr, contribution: null, codeReview: { mode: 'auto', handover: 3 } });
    expect(row(demoed!).demo).toEqual({ latest: demo('/c'), earlier: [demo('/a'), demo('/b')], share: { slug: 'csv' }, pageHeard: null, files: [{ path: 'r.md', caption: 'Report' }], held: [{ id: 4 }] });
    expect(row(planned!).plan).toEqual({ doc: { file: 'docs/plan/a.md', title: 'A' }, deps: null, collapsed: true, planDocs: null });
    // a suggestion of a label since cleared is gone; the owner's set to none stays theirs
    expect(row(labelled!).labels).toEqual({
      category: { value: 'frontend', by: 'suggestion' },
      complexity: { value: 3, by: null },
      priority: { value: 'high', by: 'owner' },
      subcategory: { value: null, by: 'owner' },
    });
    expect(row(held!).hold).toEqual({ reason: 'snoozed', since: '2026-11-08T10:00:00.000Z', until: '2026-11-09T08:00:00.000Z', by: 'owner' });
    expect(row(plain!)).toMatchObject({ review: null, demo: null, plan: null, labels: {}, hold: null });
    expect(after.cards.shared('c').map((r) => r.id)).toEqual([demoed!]);
    expect(after.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    after.db.close();
  }));

test('the columns that moved into the tables of the parts leave cards; each card keeps its own fields, its rowid and what refers to it', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    const [plan, gone, kid] = s.addCards([
      { project_id: 'c', kind: 'plan', plan_ref: 'docs/plan/a.md', x: 0, y: 0 },
      { project_id: 'c', kind: 'task', x: 1, y: 0 },
      { project_id: 'c', kind: 'task', x: 2, y: 0 },
    ]);
    s.db.query('UPDATE cards SET parent_id = $p, plan_ref = $r, status_line = $l WHERE id = $id').run({ p: plan!.id, r: 'docs/plan/a.md#W1', l: 'Testing', id: kid!.id });
    // a gap in the rowids, which the Koordinator's marks count cards by
    s.db.run('DELETE FROM cards WHERE id = ?', [gone!.id]);
    const said = s.events.add({ cardId: kid!.id, kind: 'say', author: 'worker', text: 'On it.' });
    s.updateCard(kid!.id, { review: { pr: { url: 'https://github.com/a/b/pull/1', number: 1, seen: [], reported: [] } as never }, hold: { reason: 'parkingLot', since: '2026-11-08T10:00:00.000Z' } });
    const rowids = () => s.db.query('SELECT id, rowid FROM cards ORDER BY rowid').all();
    const before = rowids();
    withMovedColumns(s.db);
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('__new_cards'))}`);
    s.db.close();

    const after = new Store(path);
    const columns = (after.db.query("SELECT name FROM pragma_table_info('cards')").all() as { name: string }[]).map((c) => c.name);
    expect(columns.filter((c) => MOVED.some((m) => m.split(' ')[0] === c))).toEqual([]);
    expect(after.db.query('SELECT id, rowid FROM cards ORDER BY rowid').all()).toEqual(before);
    expect(after.cards.get(kid!.id)).toMatchObject({ parent_id: plan!.id, plan_ref: 'docs/plan/a.md#W1', status_line: 'Testing', review: { pr: { number: 1 } }, hold: { reason: 'parkingLot' } });
    expect(after.events.of(kid!.id).map((e) => e.id)).toContain(said.id);
    expect(after.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(after.db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(() => after.db.run("UPDATE cards SET parent_id = 'nowhere' WHERE id = ?", [kid!.id])).toThrow();
    // a project's cards are read without going through its archive, as before
    for (const db of [after.db, new Store(':memory:').db]) {
      const plan = db.query("EXPLAIN QUERY PLAN SELECT id FROM cards WHERE project_id = 'c' AND deleted_at IS NULL AND archived_at IS NULL").all() as { detail: string }[];
      expect(plan.map((p) => p.detail).join()).toContain('cards_open');
    }
    after.db.close();
  }));

test('a step that builds a table anew fails if it leaves a reference to a row that is gone, leaving the database where it was', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    s.addCards([{ project_id: 'c', kind: 'task', x: 0, y: 0 }]);
    s.db.close();
    const before = RELEASED + MIGRATIONS.length;
    MIGRATIONS.push("PRAGMA foreign_keys=OFF;\nDELETE FROM projects WHERE id = 'c';\nPRAGMA foreign_keys=ON;");
    try {
      expect(() => new Store(path)).toThrow('leaves references to rows that are gone');
    } finally {
      MIGRATIONS.pop();
    }
    expect(version(path)).toBe(before);
    const again = new Store(path);
    expect(again.projects.name('c')).toBe('Shop');
    expect(again.db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    again.db.close();
  }));

test('a step that builds a table anew fails if it leaves another reference dangling, even where it clears one there was', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    s.addCards([{ project_id: 'c', kind: 'task', x: 0, y: 0 }]);
    s.db.close();
    // a reference to a card that is gone from before, written without foreign keys
    const raw = new Database(path);
    raw.run("INSERT INTO activity (at, card_id, who, code) VALUES ('2026-11-08', 'gone', 'owner', 'created')");
    raw.close();
    const before = RELEASED + MIGRATIONS.length;
    MIGRATIONS.push("PRAGMA foreign_keys=OFF;\nDELETE FROM activity WHERE card_id = 'gone';\nINSERT INTO activity (at, card_id, who, code) VALUES ('2026-11-08', 'also gone', 'owner', 'created');\nPRAGMA foreign_keys=ON;");
    try {
      expect(() => new Store(path)).toThrow('leaves references to rows that are gone');
    } finally {
      MIGRATIONS.pop();
    }
    expect(version(path)).toBe(before);
  }));

test('a card gets a part once any of it is set and loses it once all of it is cleared; a label set to nothing by nobody goes', () => {
  const s = new Store(':memory:');
  s.ensureProject('c', 'Shop');
  const [card] = s.addCards([{ project_id: 'c', kind: 'task', x: 0, y: 0, hold: { reason: 'parkingLot', since: '2026-11-08T10:00:00.000Z' } }]);
  const id = card!.id;
  expect(card!.hold).toEqual({ reason: 'parkingLot', since: '2026-11-08T10:00:00.000Z' });
  const was = card!.updated_at;
  s.updateCard(id, { demo: { latest: { kind: 'html', dir: '/d', chapters: [] }, earlier: [{ kind: 'video', dir: '/v', chapters: [] }] }, plan: { collapsed: true }, review: { pr: null }, hold: null });
  const row = s.cards.get(id)!;
  expect(row.updated_at >= was).toBe(true);
  expect(row.demo).toMatchObject({ latest: { dir: '/d' }, earlier: [{ dir: '/v' }] });
  expect([row.plan?.collapsed, row.review, row.hold]).toEqual([true, null, null]);
  // the demo part keeps its row while it has earlier demos, whatever else of it is cleared
  s.updateCard(id, { demo: { latest: null } });
  expect(s.db.query('SELECT COUNT(*) AS n FROM card_demos').get()).toEqual({ n: 1 });
  s.updateCard(id, { demo: { earlier: [] }, plan: { collapsed: false } });
  expect([s.cards.get(id)!.demo, s.cards.get(id)!.plan]).toEqual([null, null]);
  s.updateCard(id, { demo: { earlier: [{ kind: 'video', dir: '/v', chapters: [] }] } });
  expect(s.db.query('SELECT COUNT(*) AS n FROM card_demos').get()).toEqual({ n: 1 });
  s.updateCard(id, { demo: { earlier: [] } });
  s.updateCard(id, { labels: { priority: { value: 'high', by: 'owner' }, category: { value: null, by: 'owner' } } });
  expect(s.cards.get(id)!.labels).toEqual({ priority: { value: 'high', by: 'owner' }, category: { value: null, by: 'owner' } });
  s.updateCard(id, { labels: { priority: null, category: { value: null, by: null } } });
  expect(s.cards.get(id)!.labels).toEqual({});
  for (const t of ['card_reviews', 'card_demos', 'card_earlier_demos', 'card_plans', 'card_labels', 'card_holds']) expect(s.db.query(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
});

test('canvases: names unique per project in any case, ordered, a plan moves with its workstreams, a deleted one leaves its archive on main', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    s.ensureProject('d', 'Site');
    const ideas = s.canvases.add('c', 'Ideas', '💡');
    s.canvases.add('d', 'Ideas', null);
    expect(() => s.canvases.add('c', 'ideas', null)).toThrow();
    const later = s.canvases.add('c', 'Later', null);
    expect(s.canvases.of('c').map((v) => v.name)).toEqual(['main', 'Ideas', 'Later']);
    s.canvases.order([later.id, s.canvases.main('c'), ideas.id]);
    expect(s.canvases.of('c').map((v) => v.name)).toEqual(['Later', 'main', 'Ideas']);
    const [plan] = s.addCards([{ project_id: 'c', kind: 'plan', plan_ref: 'p.md', x: 0, y: 0 }]);
    const [kid] = s.addCards([{ project_id: 'c', kind: 'task', parent_id: plan!.id, plan_ref: 'p.md#w', x: 0, y: 0 }]);
    expect(kid!.canvas_id).toBe(s.canvases.main('c'));
    s.cards.setCanvas([plan!.id], ideas.id);
    expect([s.cards.get(plan!.id)!.canvas_id, s.cards.get(kid!.id)!.canvas_id]).toEqual([ideas.id, ideas.id]);
    const [old] = s.addCards([{ project_id: 'c', canvas_id: later.id, kind: 'task', x: 0, y: 0 }]);
    s.cards.update(old!.id, { archived_at: '2026-11-01' });
    expect(s.cards.onCanvas(later.id)).toBe(0);
    s.deleteCanvas(later.id, s.canvases.main('c'));
    expect(s.cards.get(old!.id)!.canvas_id).toBe(s.canvases.main('c'));
    expect(s.canvases.of('c').map((v) => [v.name, v.position])).toEqual([['main', 0], ['Ideas', 1]]);
    // groups of a deleted canvas merge into main's group of the same name
    const gone = s.canvases.add('c', 'Gone', null);
    const keep = s.groups.add('c', 'Billing', 1, s.canvases.main('c'));
    const dupe = s.groups.add('c', 'billing', 2, gone.id);
    const solo = s.groups.add('c', 'Solo', 3, gone.id);
    const [a] = s.addCards([{ project_id: 'c', canvas_id: gone.id, kind: 'task', group_id: dupe.id, x: 0, y: 0 }]);
    s.cards.update(a!.id, { archived_at: '2026-11-01' });
    s.deleteCanvas(gone.id, s.canvases.main('c'));
    expect(s.cards.get(a!.id)!.group_id).toBe(keep.id);
    expect(s.groups.get(dupe.id)).toBeNull();
    expect(s.groups.get(solo.id)!.canvasId).toBe(s.canvases.main('c'));
    s.db.close();
  }));

test('a pending migration is preceded by a backup of the database, and only the newest are kept', () =>
  withPath((path) => {
    const s = new Store(path);
    s.db.run("INSERT INTO projects (id, name, created_at) VALUES ('p', 'keep me', 1)");
    s.db.close();
    const dir = dirname(path);
    for (const v of [1, 2, 3, 4]) writeFileSync(`${path}.before-${v}`, 'old');
    const before = RELEASED + MIGRATIONS.length;
    MIGRATIONS.push('CREATE TABLE backup_probe (id INTEGER)');
    try {
      new Store(path).db.close();
    } finally {
      MIGRATIONS.pop();
    }
    const copy = new Database(`${path}.before-${before + 1}`);
    expect(copy.query('PRAGMA user_version').get()).toEqual({ user_version: before });
    expect(copy.query("SELECT name FROM projects WHERE id = 'p'").get()).toEqual({ name: 'keep me' });
    expect(copy.query("SELECT 1 FROM sqlite_master WHERE name = 'backup_probe'").get()).toBeNull();
    copy.close();
    expect(version(path)).toBe(before + 1);
    expect(readdirSync(dir).filter((f) => f.includes('.before-')).sort()).toEqual(['obeya.db.before-3', 'obeya.db.before-4', `obeya.db.before-${before + 1}`]);
    // up to date and fresh databases are not backed up
    const names = readdirSync(dir).sort();
    MIGRATIONS.push('CREATE TABLE backup_probe (id INTEGER)');
    try {
      new Store(path).db.close();
    } finally {
      MIGRATIONS.pop();
    }
    expect(readdirSync(dir).sort()).toEqual(names);
  }));

test('a retried migration keeps the backup of the first attempt, the state before the upgrade', () =>
  withPath((path) => {
    new Store(path).db.close();
    const before = RELEASED + MIGRATIONS.length;
    MIGRATIONS.push('CREATE TABLE step_one (id INTEGER)', 'THIS IS NOT SQL');
    try {
      expect(() => new Store(path)).toThrow();
      expect(version(path)).toBe(before + 1);
      MIGRATIONS[MIGRATIONS.length - 1] = 'CREATE TABLE step_two (id INTEGER)';
      new Store(path).db.close();
    } finally {
      MIGRATIONS.length -= 2;
    }
    const copy = new Database(`${path}.before-${before + 2}`);
    expect(copy.query('PRAGMA user_version').get()).toEqual({ user_version: before });
    expect(copy.query("SELECT 1 FROM sqlite_master WHERE name = 'step_one'").get()).toBeNull();
    copy.close();
  }));
