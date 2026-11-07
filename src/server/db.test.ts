import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    old.run('CREATE TABLE canvases (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)');
    old.run(`PRAGMA user_version = ${RELEASED - 1}`);
    old.close();
    expect(() => new Store(path)).toThrow(OlderDatabase);
    expect(version(path)).toBe(RELEASED - 1);
  }));

test('what an Seismic before the release kept in earlier shapes is in today’s', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureCanvas('c', 'C');
    const [video, answered, held, project] = s.insert([
      { canvas_id: 'c', kind: 'task', state: 'waiting', x: 0, y: 0 },
      { canvas_id: 'c', kind: 'task', state: 'waiting', x: 0, y: 1 },
      { canvas_id: 'c', kind: 'task', state: 'done', x: 0, y: 2 },
      { canvas_id: 'c', kind: 'project', plan_ref: 'docs/plan/gone.md', title: 'Gone', x: 0, y: 3 },
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
    s.db.run(`PRAGMA user_version = ${RELEASED}`);
    s.db.close();

    const after = new Store(path);
    expect(JSON.parse(after.card(video!.id)!.demo!)).toEqual({ dir: '/d', chapters: [], kind: 'video' });
    expect(JSON.parse(after.card(video!.id)!.detail!)).toEqual({ answering: true });
    expect(after.events(video!.id).find((e) => e.id === paused.id)!.text).toBe('Paused.');
    expect(JSON.parse(after.card(answered!.id)!.demo!).handover).toBe(first.id);
    expect(JSON.parse(after.card(held!.id)!.share!)).toMatchObject({ state: 'publishing', shown: { kind: 'video' } });
    expect(JSON.parse(after.card(project!.id)!.plan!)).toEqual({ file: 'docs/plan/gone.md', title: 'Gone', goal: '', workstreams: [], markdown: '' });
    expect(after.setting('c', 'work_retro_runs:app')).toBe('3');
    expect(after.card(video!.id)!.agent_setting).toBeNull();
    expect(after.card(video!.id)!.short).toBe(video!.id.replaceAll('-', '').slice(0, SHORT));
    after.db.close();
  }));

test('a card gets the shortest code no other card has: the start of its id, one digit longer for each card that shares it', () => {
  const s = new Store(':memory:');
  s.ensureCanvas('c', 'C');
  const [a] = s.insert([{ canvas_id: 'c', kind: 'task', x: 0, y: 0 }]);
  expect(a!.short).toMatch(new RegExp(`^[0-9a-f]{${SHORT}}$`));
  expect(a!.id.replaceAll('-', '').startsWith(a!.short)).toBe(true);
  // ids that share their start with cards there are already
  const ids = ['abcdef01-0000-4000-8000-000000000001', 'abcdef01-0000-4000-8000-000000000002', 'abcdef01-0000-4000-8000-000000000003'];
  const real = crypto.randomUUID;
  let n = 0;
  crypto.randomUUID = () => ids[n++] as ReturnType<typeof crypto.randomUUID>;
  try {
    expect(s.insert([0, 1, 2].map((y) => ({ canvas_id: 'c', kind: 'task' as const, x: 0, y }))).map((r) => r.short)).toEqual(['abcdef', 'abcdef0', 'abcdef01']);
  } finally {
    crypto.randomUUID = real;
  }
});

test('the migration gives the cards there are codes of their own, longer where their ids start alike', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureCanvas('c', 'C');
    const ids = ['12345678-0000-4000-8000-000000000001', '12345678-0000-4000-8000-000000000002', '1234aaaa-0000-4000-8000-000000000003', 'ffffffff-0000-4000-8000-000000000004'];
    const insert = s.db.query("INSERT INTO cards (id, short, canvas_id, kind, x, y, created_at, updated_at) VALUES ($id, $id, 'c', 'task', 0, 0, '', '')");
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
    s.db.run(`PRAGMA user_version = ${RELEASED + MIGRATIONS.findIndex((m) => m.includes('ADD COLUMN short'))}`);
    s.db.close();
    const after = new Store(path);
    expect(ids.map((id) => after.card(id)!.short)).toEqual(['12345678000040008000000000000001', '12345678000040008000000000000002', '1234aa', 'ffffff']);
    after.db.close();
  }));

test('the sessions of cards from before runs were recorded: the last as pinned, one for each other identity their agents spoke as', () =>
  withPath((path) => {
    const s = new Store(path);
    s.ensureCanvas('c', 'C');
    const [pinned, spoke, legacy, mixed, idle] = s.insert([0, 1, 2, 3, 4].map((y) => ({ canvas_id: 'c', kind: 'task' as const, x: 0, y })));
    s.update(pinned!.id, { session_id: 's-1', agent_setting: JSON.stringify({ model: 'opus', effort: 'high' }) });
    s.update(spoke!.id, { session_id: 'codex:t-1', agent_setting: JSON.stringify({ model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'gpt-x', effort: 'low' } }) });
    s.addEvent({ cardId: spoke!.id, kind: 'say', author: 'worker', text: 'On it.', agent: { harness: 'codex', model: 'gpt-x' } });
    s.addEvent({ cardId: spoke!.id, kind: 'say', author: 'koordinator', text: 'Not the worker.', agent: { harness: 'claude', model: 'claude-opus-5-5' } });
    s.update(legacy!.id, { session_id: 'old-claude' });
    const [named] = s.insert([{ canvas_id: 'c', kind: 'task', x: 1, y: 0 }]);
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
    s.ensureCanvas('c', 'C');
    const [card] = s.insert([{ canvas_id: 'c', kind: 'task', x: 0, y: 0, title: 'T' }]);
    s.recordRun(card!.id, 's-1', { harness: 'claude', model: 'm', effort: 'high' }, '2026-01-01T00:00:00.000Z');
    const given = { cardId: card!.id, canvasId: 'c', handover: 7, title: 'T', attribution: 'single' as const, configs: [{ harness: 'claude' as const, model: 'm', effort: 'high' as const }], answer: { rating: 3 } };
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
  store.db.run("INSERT INTO canvases (id, name, created_at) VALUES ('c', 'Shop', '2026-11-01'), ('d', 'Site', '2026-11-01')");
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
  expect(store.chats().map((x) => x.canvas).sort()).toEqual(['c', 'c', 'd']);
  // a new chat left without a word in it goes once another is opened
  const empty = store.newChat('c');
  store.openChat('c', second);
  expect(store.chats('c').map((x) => x.id)).not.toContain(empty);
  expect(store.db.query('SELECT 1 FROM chats WHERE id = $id').get({ id: empty })).toBeNull();
});

test('a chat opened and a new one made in the same millisecond become current in turn', () => {
  const store = new Store(':memory:');
  store.db.run("INSERT INTO canvases (id, name, created_at) VALUES ('c', 'Shop', '2026-11-01')");
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

test('what was said before chats existed becomes one chat per canvas', () =>
  withPath((path) => {
    const store = new Store(path);
    store.db.run("INSERT INTO canvases (id, name, created_at) VALUES ('c', 'Shop', '2026-11-01')");
    store.addTalk('c', 'eins', 'A', null);
    store.addTalk('c', 'zwei', 'B', null);
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
