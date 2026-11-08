import { expect, test } from 'bun:test';
import { Store } from './db';
import { projectCsv, projectData } from './data-export';

test('exports only the chosen project with its card and conversation, including deleted records', () => {
  const store = new Store(':memory:');
  store.ensureProject('one', 'One');
  store.ensureProject('two', 'Two');
  store.db.query("INSERT INTO cards (id, short, project_id, kind, x, y, created_at, updated_at, deleted_at) VALUES ('a', 'aaaaaa', 'one', 'task', 0, 0, 'now', 'now', 'now'), ('b', 'bbbbbb', 'two', 'task', 0, 0, 'now', 'now', NULL)").run();
  store.db.query("INSERT INTO events (card_id, at, kind, author, text) VALUES ('a', 'now', 'talk', 'owner', 'hello'), ('b', 'now', 'talk', 'owner', 'other')").run();
  const data = projectData(store, ['one']);
  expect(data.tables.cards?.map((r) => r.id)).toEqual(['a']);
  expect(data.tables.events?.map((r) => r.card_id)).toEqual(['a']);
  expect(data.tables.projects).toEqual([{ id: 'one', name: 'One', created_at: expect.any(String) }]);
  expect(projectCsv(data)).toContain('""card_id"":""a""');
  expect(projectCsv(data).split('\r\n').find((line) => line.startsWith('"events"'))?.startsWith('"events","one",')).toBe(true);
  store.db.close();
});
