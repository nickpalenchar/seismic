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
  const created = await cards.create({ ...newCard, labels: { set: { size: { value: 'big', by: 'owner' } } } as never });
  const found = await cards.find(created.id);
  expect(found?.title).toBe('first');
  expect(Object.isFrozen(found)).toBe(true);
  expect(Object.isFrozen(found?.labels)).toBe(true);
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
