import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CardEvent } from '../core/types';
import { MIGRATIONS, NewerDatabase, OlderDatabase, RELEASED, SHORT, Store } from './db';

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

/** The database as it was before projects had canvases: the migration that brought them undone, and the ones after it. */
function withoutCanvases(db: Database) {
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
    const [video, answered, held, plan] = s.insert([
      { project_id: 'c', kind: 'task', state: 'waiting', x: 0, y: 0 },
      { project_id: 'c', kind: 'task', state: 'waiting', x: 0, y: 1 },
      { project_id: 'c', kind: 'task', state: 'done', x: 0, y: 2 },
      { project_id: 'c', kind: 'project' as 'plan', plan_ref: 'docs/plan/gone.md', title: 'Gone', x: 0, y: 3 },
    ]);
    const log = (cardId: string, kind: CardEvent['kind'], author: CardEvent['author'], text: string) => s.addEvent({ cardId, kind, author, text });
    const first = log(answered!.id, 'review', 'worker', 'Done.');
    log(answered!.id, 'answer', 'owner', 'Yes');
    log(answered!.id, 'review', 'worker', 'Done again.');
    const paused = log(video!.id, 'state', 'owner', 'Paused. The agent goes on when you click “Resume” or write to it.');
    s.update(video!.id, { demo: JSON.stringify({ dir: '/d', chapters: [], answering: true }) });
    s.update(answered!.id, { demo: JSON.stringify({ kind: 'video', dir: '/d', chapters: [], question: 'Q?', answer: 'Yes' }) });
    s.update(held!.id, { share: JSON.stringify({ slug: 's', state: 'pending', dir: '/d', shown: { title: 'T', text: '', chapters: [] } }) });
    s.setSetting('c', 'work_retro_since:app', '2026-10-01T00:00:00Z');
    // the schema as released: without the columns and indexes later migrations add
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
    s.addDecision({ project_id: 'c', plan_id: plan!.id, card_id: plan!.id, question: 'q', answer: 'a', by: 'plan' });
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
    expect(after.decisions('c', plan!.id)[0]!.by).toBe('plan');
    expect(JSON.parse(after.card(video!.id)!.demo!)).toEqual({ dir: '/d', chapters: [], kind: 'video' });
    expect(JSON.parse(after.card(video!.id)!.detail!)).toEqual({ answering: true });
    expect(after.events(video!.id).find((e) => e.id === paused.id)!.text).toBe('Paused.');
    expect(JSON.parse(after.card(answered!.id)!.demo!).handover).toBe(first.id);
    expect(JSON.parse(after.card(held!.id)!.share!)).toMatchObject({ state: 'publishing', shown: { kind: 'video' } });
    expect(after.card(plan!.id)!.kind).toBe('plan');
    expect(JSON.parse(after.card(plan!.id)!.plan!)).toEqual({ file: 'docs/plan/gone.md', title: 'Gone', goal: '', workstreams: [], markdown: '' });
    expect(after.setting('c', 'work_retro_runs:app')).toBe('3');
    expect(after.card(video!.id)!.agent_setting).toBeNull();
    expect(after.card(video!.id)!.workstation).toBe('/w/1');
    expect(JSON.parse(after.card(video!.id)!.queue!)).toEqual({ since: '2026-01-01', workstation: 'dirty', begun: true });
    expect(after.workstations('c')).toEqual([{ path: '/w/1', card_id: video!.id }]);
    expect(after.card(video!.id)!.short).toBe(video!.id.replaceAll('-', '').slice(0, SHORT));
    after.db.close();
  }));

test('a card gets the shortest code no other card has: the start of its id, one digit longer for each card that shares it', () => {
  const s = new Store(':memory:');
  s.ensureProject('c', 'C');
  const [a] = s.insert([{ project_id: 'c', kind: 'task', x: 0, y: 0 }]);
  expect(a!.short).toMatch(new RegExp(`^[0-9a-f]{${SHORT}}$`));
  expect(a!.id.replaceAll('-', '').startsWith(a!.short)).toBe(true);
  // ids that share their start with cards there are already
  const ids = ['abcdef01-0000-4000-8000-000000000001', 'abcdef01-0000-4000-8000-000000000002', 'abcdef01-0000-4000-8000-000000000003'];
  const real = crypto.randomUUID;
  let n = 0;
  crypto.randomUUID = () => ids[n++] as ReturnType<typeof crypto.randomUUID>;
  try {
    expect(s.insert([0, 1, 2].map((y) => ({ project_id: 'c', kind: 'task' as const, x: 0, y }))).map((r) => r.short)).toEqual(['abcdef', 'abcdef0', 'abcdef01']);
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
    expect(ids.map((id) => after.card(id)!.short)).toEqual(['12345678000040008000000000000001', '12345678000040008000000000000002', '1234aa', 'ffffff']);
    after.db.close();
  }));

test('the sessions of cards from before runs were recorded: the last as pinned, one for each other identity their agents spoke as', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'C');
    const [pinned, spoke, legacy, mixed, idle] = s.insert([0, 1, 2, 3, 4].map((y) => ({ project_id: 'c', kind: 'task' as const, x: 0, y })));
    s.update(pinned!.id, { session_id: 's-1', agent_setting: JSON.stringify({ model: 'opus', effort: 'high' }) });
    s.update(spoke!.id, { session_id: 'codex:t-1', agent_setting: JSON.stringify({ model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'gpt-x', effort: 'low' } }) });
    s.addEvent({ cardId: spoke!.id, kind: 'say', author: 'worker', text: 'On it.', agent: { harness: 'codex', model: 'gpt-x' } });
    s.addEvent({ cardId: spoke!.id, kind: 'say', author: 'koordinator', text: 'Not the worker.', agent: { harness: 'claude', model: 'claude-opus-5-5' } });
    s.update(legacy!.id, { session_id: 'old-claude' });
    const [named] = s.insert([{ project_id: 'c', kind: 'task', x: 1, y: 0 }]);
    s.update(named!.id, { session_id: 'codex:t-2', agent_setting: JSON.stringify({ model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'gpt-y', effort: 'max' } }) });
    s.update(mixed!.id, { session_id: 's-3', agent_setting: JSON.stringify({ model: 'sonnet', effort: 'low' }) });
    s.addEvent({ cardId: mixed!.id, kind: 'say', author: 'worker', text: 'First.', agent: { harness: 'claude', model: 'claude-opus-5-5' } });
    s.addEvent({ cardId: mixed!.id, kind: 'say', author: 'worker', text: 'Second.', agent: { harness: 'claude', model: 'claude-sonnet-5-5' } });
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
    const runs = (id: string) => after.runs(id).map(({ at: _, ...r }) => r);
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
    after.recordRun(pinned!.id, 's-1', { harness: 'codex', model: 'claude-opus-5-5', effort: 'low' });
    expect(runs(pinned!.id)).toEqual([{ session: 's-1', harness: 'claude', model: 'claude-opus-5-5', effort: 'high', requested: 'opus' }]);
    after.db.close();
  }));

test('runs and responses survive a restart, one response for each handover', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'C');
    const [card] = s.insert([{ project_id: 'c', kind: 'task', x: 0, y: 0, title: 'T' }]);
    s.recordRun(card!.id, 's-1', { harness: 'claude', model: 'm', effort: 'high' }, '2026-01-01T00:00:00.000Z');
    const given = { cardId: card!.id, projectId: 'c', handover: 7, title: 'T', attribution: 'single' as const, configs: [{ harness: 'claude' as const, model: 'm', effort: 'high' as const }], answer: { rating: 3 } };
    const first = s.putFeedback(given);
    s.putFeedback({ ...given, configs: [], attribution: 'missing' });
    s.db.close();
    const after = new Store(path);
    expect(after.runs(card!.id)).toHaveLength(1);
    expect(after.feedback()).toEqual([first]);
    after.db.close();
  }));

test('chats: words go into the one opened last, a new one only once something was said, answers wait unread in theirs', () => {
  const store = new Store(':memory:');
  store.db.run("INSERT INTO projects (id, name, created_at) VALUES ('c', 'Shop', '2026-11-01'), ('d', 'Site', '2026-11-01')");
  const first = store.chat('c');
  expect(store.chatModel('c')).toBeUndefined();
  store.setChatModel('c', 'sonnet');
  expect(store.chatModel('c')).toBe('sonnet');
  expect(store.newChat('c')).toBe(first);
  const asked = store.addTalk('c', 'wie viele Tests?', '', null, { question: 'wie viele Tests?', about: null });
  const second = store.newChat('c');
  expect(second).not.toBe(first);
  expect(store.chatModel('c')).toBeUndefined();
  store.addTalk('c', 'hallo', 'Hallo!', null);
  store.addTalk('d', 'anderswo', 'Ja.', null);
  // the answer comes in the chat it was asked in, while the owner talks in another
  store.answerTalk(asked, '42', 'koordinator');
  expect(store.sheet('c', second, 30).map((t) => [t.said, t.chat, !!t.unread])).toEqual([
    ['wie viele Tests?', first, true],
    ['hallo', second, false],
  ]);
  expect(store.chats('c').map((x) => [x.title, x.unread])).toEqual([
    ['hallo', undefined],
    ['wie viele Tests?', 1],
  ]);
  // only the chat in view is read
  expect(store.readTalk('c')).toBe(false);
  expect(store.openChat('c', first)).toBe(true);
  expect(store.chat('c')).toBe(first);
  expect(store.chatModel('c')).toBe('sonnet');
  expect(store.readTalk('c')).toBe(true);
  expect(store.openChat('d', first)).toBe(false);
  expect(store.chats().map((x) => x.project).sort()).toEqual(['c', 'c', 'd']);
  // a new chat left without a word in it goes once another is opened
  const empty = store.newChat('c');
  store.openChat('c', second);
  expect(store.chats('c').map((x) => x.id)).not.toContain(empty);
  expect(store.db.query('SELECT 1 FROM chats WHERE id = $id').get({ id: empty })).toBeNull();
});

test('a chat opened and a new one made in the same millisecond become current in turn', () => {
  const store = new Store(':memory:');
  store.db.run("INSERT INTO projects (id, name, created_at) VALUES ('c', 'Shop', '2026-11-01')");
  const first = store.chat('c');
  store.addTalk('c', 'first', '', null);
  const second = store.newChat('c');
  store.addTalk('c', 'second', '', null);
  store.openChat('c', first);
  expect(store.chat('c')).toBe(first);
  const third = store.newChat('c');
  expect(store.chat('c')).toBe(third);
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
    const chats = again.chats('c');
    expect(chats.map((x) => x.title)).toEqual(['eins']);
    expect(again.talk('c', 20, false, chats[0]!.id).map((t) => t.said)).toEqual(['eins', 'zwei']);
    again.db.close();
  }));

test('what an Seismic kept while projects were canvases is in today’s names, tables and stored JSON', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    const [card] = s.insert([{ project_id: 'c', kind: 'task', x: 0, y: 0 }]);
    s.setSetting('c', 'paused', '');
    s.addTalk('c', 'eins', 'A', null);
    s.addMoved('c', { card: card!.id, title: 'T', project: 'd', projectName: 'Site' } as never, 'moved');
    const made = s.addEvent({ cardId: card!.id, kind: 'say', author: 'worker', text: 'Made.' });
    asCanvases(s.db);
    s.db.run(`UPDATE talk SET moved = '{"card":"x","title":"T","canvas":"d","canvasName":"Site"}' WHERE moved IS NOT NULL`);
    s.db.run(`UPDATE cards SET new_repo = '{"path":"/r","canvas":true,"by":"owner"}' WHERE id = '${card!.id}'`);
    s.db.query('UPDATE events SET made = $made WHERE id = $id').run({ made: '{"card":"y","title":"U","canvas":"d"}', id: made.id });
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes("ALTER TABLE canvases RENAME TO projects"))}`);
    s.db.close();

    const after = new Store(path);
    expect(after.projectName('c')).toBe('Shop');
    expect(after.setting('c', 'paused')).toBe('');
    expect(JSON.parse(after.card(card!.id)!.new_repo!)).toEqual({ path: '/r', by: 'owner', project: true });
    expect(after.events(card!.id).find((e) => e.id === made.id)!.made).toEqual({ card: 'y', title: 'U', project: 'd' });
    expect(after.talk('c', 20, false).find((t) => t.moved)!.moved).toEqual({ card: 'x', title: 'T', project: 'd', projectName: 'Site' });
    // what names a canvas now is the canvas layer's, which came after
    const layer = (o: { name: string; sql: string | null }) => /^(canvases|canvases_name|cards_canvas|sqlite_autoindex_canvases_1)$/.test(o.name);
    const names = (after.db.query('SELECT name, sql FROM sqlite_master').all() as { name: string; sql: string | null }[])
      .filter((o) => !layer(o) && /canvas/i.test(o.name + (o.sql ?? '').replace(/, canvas_id TEXT/, '')));
    expect(names).toEqual([]);
    after.db.close();
  }));

test('the migration gives every project a canvas main holding all its cards and groups', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    s.ensureProject('d', 'Site');
    const [a, plan] = s.insert([
      { project_id: 'c', kind: 'task', x: 0, y: 0 },
      { project_id: 'c', kind: 'plan', plan_ref: 'docs/plan/a.md', x: 0, y: 0 },
    ]);
    const [kid] = s.insert([{ project_id: 'c', kind: 'task', parent_id: plan!.id, plan_ref: 'docs/plan/a.md#w1', x: 0, y: 0 }]);
    const [b] = s.insert([{ project_id: 'd', kind: 'task', x: 0, y: 0 }]);
    s.update(b!.id, { archived_at: '2026-11-01' });
    const g = s.addGroup('c', 'Billing', 200);
    s.setGroup([a!.id], g.id);
    s.db.run('DROP TABLE activity');
    withoutCanvases(s.db);
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE canvases'))}`);
    s.db.close();

    const after = new Store(path);
    for (const p of ['c', 'd']) expect(after.canvases(p).map((v) => [v.name, v.position])).toEqual([['main', 0]]);
    const main = after.mainCanvas('c');
    expect([a, plan, kid].map((r) => after.card(r!.id)!.canvas_id)).toEqual([main, main, main]);
    expect(after.card(b!.id)!.canvas_id).toBe(after.mainCanvas('d'));
    expect(after.group(g.id)!.canvas_id).toBe(main);
    expect(after.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    after.db.close();
  }));

test('canvases: names unique per project in any case, ordered, a plan moves with its workstreams, a deleted one leaves its archive on main', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureProject('c', 'Shop');
    s.ensureProject('d', 'Site');
    const ideas = s.addCanvas('c', 'Ideas', '💡');
    s.addCanvas('d', 'Ideas', null);
    expect(() => s.addCanvas('c', 'ideas', null)).toThrow();
    const later = s.addCanvas('c', 'Later', null);
    expect(s.canvases('c').map((v) => v.name)).toEqual(['main', 'Ideas', 'Later']);
    s.orderCanvases([later.id, s.mainCanvas('c'), ideas.id]);
    expect(s.canvases('c').map((v) => v.name)).toEqual(['Later', 'main', 'Ideas']);
    const [plan] = s.insert([{ project_id: 'c', kind: 'plan', plan_ref: 'p.md', x: 0, y: 0 }]);
    const [kid] = s.insert([{ project_id: 'c', kind: 'task', parent_id: plan!.id, plan_ref: 'p.md#w', x: 0, y: 0 }]);
    expect(kid!.canvas_id).toBe(s.mainCanvas('c'));
    s.setCanvas([plan!.id], ideas.id);
    expect([s.card(plan!.id)!.canvas_id, s.card(kid!.id)!.canvas_id]).toEqual([ideas.id, ideas.id]);
    const [old] = s.insert([{ project_id: 'c', canvas_id: later.id, kind: 'task', x: 0, y: 0 }]);
    s.update(old!.id, { archived_at: '2026-11-01' });
    expect(s.cardsOnCanvas(later.id)).toBe(0);
    s.deleteCanvas(later.id, s.mainCanvas('c'));
    expect(s.card(old!.id)!.canvas_id).toBe(s.mainCanvas('c'));
    expect(s.canvases('c').map((v) => [v.name, v.position])).toEqual([['main', 0], ['Ideas', 1]]);
    // groups of a deleted canvas merge into main's group of the same name
    const gone = s.addCanvas('c', 'Gone', null);
    const keep = s.addGroup('c', 'Billing', 1, s.mainCanvas('c'));
    const dupe = s.addGroup('c', 'billing', 2, gone.id);
    const solo = s.addGroup('c', 'Solo', 3, gone.id);
    const [a] = s.insert([{ project_id: 'c', canvas_id: gone.id, kind: 'task', group_id: dupe.id, x: 0, y: 0 }]);
    s.update(a!.id, { archived_at: '2026-11-01' });
    s.deleteCanvas(gone.id, s.mainCanvas('c'));
    expect(s.card(a!.id)!.group_id).toBe(keep.id);
    expect(s.group(dupe.id)).toBeNull();
    expect(s.group(solo.id)!.canvas_id).toBe(s.mainCanvas('c'));
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
