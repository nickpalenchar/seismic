import { expect, test } from 'bun:test';
import { Store } from './db';
import { canvasCsv, canvasData } from './data-export';

test('exports only the chosen canvas with its card and conversation, including deleted records', () => {
  const store = new Store(':memory:');
  store.ensureCanvas('one', 'One');
  store.ensureCanvas('two', 'Two');
  store.db.query("INSERT INTO cards (id, short, canvas_id, kind, x, y, created_at, updated_at, deleted_at) VALUES ('a', 'aaaaaa', 'one', 'task', 0, 0, 'now', 'now', 'now'), ('b', 'bbbbbb', 'two', 'task', 0, 0, 'now', 'now', NULL)").run();
  store.db.query("INSERT INTO events (card_id, at, kind, author, text) VALUES ('a', 'now', 'talk', 'owner', 'hello'), ('b', 'now', 'talk', 'owner', 'other')").run();
  const data = canvasData(store, ['one']);
  expect(data.tables.cards?.map((r) => r.id)).toEqual(['a']);
  expect(data.tables.events?.map((r) => r.card_id)).toEqual(['a']);
  expect(data.tables.canvases).toEqual([{ id: 'one', name: 'One', created_at: expect.any(String) }]);
  expect(canvasCsv(data)).toContain('""card_id"":""a""');
  expect(canvasCsv(data).split('\r\n').find((line) => line.startsWith('"events"'))?.startsWith('"events","one",')).toBe(true);
  store.db.close();
});
