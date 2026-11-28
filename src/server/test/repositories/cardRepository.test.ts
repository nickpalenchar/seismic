import { expect, test } from 'bun:test';
import { CardRepository } from '../../repositories/cardRepository';
import { Store } from '../../store';

function setup() {
  const store = new Store(':memory:');
  store.ensureProject('p', 'Project');
  return { store, cards: new CardRepository(store.database) };
}

const newCard = { project_id: 'p', kind: 'task' as const, x: 1, y: 2, title: 'first' };

test('a created card is found by its id, with its parts, and the record is deeply frozen', async () => {
  const { cards } = setup();
  const created = await cards.create({ ...newCard, labels: { priority: { value: 'high', by: 'owner' } } });
  const found = await cards.find(created.id);
  expect(found?.title).toBe('first');
  expect(Object.isFrozen(found)).toBe(true);
  expect(Object.isFrozen(found?.labels)).toBe(true);
  expect(found?.labels.priority?.value).toBe('high');
});

test('findMany reads by ids, deleted cards included, and by project, open cards only', async () => {
  const { cards } = setup();
  const [a, b, c] = await cards.createMany([newCard, { ...newCard, title: 'second' }, { ...newCard, title: 'third' }]);
  await cards.delete(b!.id);
  expect((await cards.findMany({ ids: [a!.id, b!.id] })).map((card) => card.title).sort()).toEqual(['first', 'second']);
  expect((await cards.findMany({ projectId: 'p' })).map((card) => card.id).sort()).toEqual([a!.id, c!.id].sort());
  await expect(cards.findMany({})).rejects.toThrow('ids or a projectId');
});

test('an update changes the card and its parts, and a delete is a soft one', async () => {
  const { cards } = setup();
  const created = await cards.create(newCard);
  const updated = await cards.update(created.id, { title: 'renamed' });
  expect(updated?.title).toBe('renamed');
  expect(updated?.updated_at).toBeDefined();
  expect(await cards.delete(created.id)).toBe(true);
  expect(await cards.delete(created.id)).toBe(false);
  expect((await cards.find(created.id))?.deleted_at).not.toBeNull();
  expect(await cards.update('missing', { title: 'x' })).toBeUndefined();
});

test('Store writes the same cards: addCards and updateCard go through the repository', async () => {
  const { store } = setup();
  const [row] = store.addCards([newCard]);
  store.updateCard(row!.id, { title: 'via store' });
  expect((await store.cardRepository.find(row!.id))?.title).toBe('via store');
});

test('a card cached by find is dropped by every kind of write through Store.cards', async () => {
  const { store } = setup();
  const [row] = store.addCards([newCard]);
  const id = row!.id;
  const read = async () => (await store.cardRepository.find(id))!;
  expect((await read()).title).toBe('first');
  store.cards.update(id, { title: 'updated' });
  expect((await read()).title).toBe('updated');
  store.cards.touch(id);
  store.cards.setGroup([id], null);
  store.cards.replan(id, null, null);
  store.cards.setProject(id, 'p', store.canvases.main('p'));
  store.cards.setCanvas([id], store.canvases.main('p'));
  const before = await read();
  store.updateCard(id, { hold: null, labels: { priority: { value: 'high', by: 'owner' } } });
  expect((await read()).updated_at >= before.updated_at).toBe(true);
  expect((await read()).labels).not.toEqual(before.labels);
  store.cards.update(id, { deleted_at: '2026-11-27T00:00:00.000Z' });
  expect((await read()).deleted_at).toBe('2026-11-27T00:00:00.000Z');
  expect(store.cards.sweepUntitled('p', '2999-01-01')).toBeGreaterThanOrEqual(0);
});

test('a card is read from the cache until a write drops it', async () => {
  const { store } = setup();
  const [row] = store.addCards([newCard]);
  const first = await store.cardRepository.find(row!.id);
  expect(await store.cardRepository.find(row!.id)).toBe(first);
  store.cards.update(row!.id, { title: 'changed' });
  expect(await store.cardRepository.find(row!.id)).not.toBe(first);
});

test('the cards of a transaction that fails are not stored', async () => {
  const { store, cards } = setup();
  await expect(
    store.database.transaction(async () => {
      await cards.create(newCard);
      throw new Error('stop');
    }),
  ).rejects.toThrow('stop');
  expect(await cards.findMany({ projectId: 'p' })).toEqual([]);
});
