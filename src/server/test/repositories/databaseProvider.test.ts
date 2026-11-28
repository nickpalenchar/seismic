import { expect, test } from 'bun:test';
import { Store } from '../../store';

function setup() {
  const store = new Store(':memory:');
  return { database: store.database, hints: store.hintRepository };
}

test('a transaction commits what its repository calls wrote, and settles after the commit', async () => {
  const { database, hints } = setup();
  await database.transaction(async () => {
    await hints.create({ id: 'a' });
    await hints.create({ id: 'b' });
  });
  expect(database.orm.$client.inTransaction).toBe(false);
  expect((await hints.findMany({})).map((hint) => hint.id).sort()).toEqual(['a', 'b']);
});

test('a transaction that fails rolls everything back and drops what was cached', async () => {
  const { database, hints } = setup();
  await hints.create({ id: 'kept' });
  await hints.find('kept');
  await expect(
    database.transaction(async () => {
      await hints.create({ id: 'a' });
      await hints.delete('kept');
      throw new Error('stop');
    }),
  ).rejects.toThrow('stop');
  expect(await hints.find('a')).toBeUndefined();
  expect((await hints.find('kept'))?.id).toBe('kept');
});

test('what a transaction reads inside it is not cached, so a rollback leaves nothing stale', async () => {
  const { database, hints } = setup();
  await expect(
    database.transaction(async () => {
      await hints.create({ id: 'a' });
      expect(await hints.find('a')).toBeDefined();
      throw new Error('stop');
    }),
  ).rejects.toThrow();
  expect(await hints.find('a')).toBeUndefined();
});

test('a call from outside waits for the open transaction, and reads what it committed', async () => {
  const { database, hints } = setup();
  let outsider: Promise<unknown> | undefined;
  await database.transaction(async () => {
    await hints.create({ id: 'a' });
    outsider = hints.findMany({ ids: ['a'] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await hints.create({ id: 'b' });
  });
  expect((await outsider) as unknown[]).toHaveLength(1);
  expect(await hints.findMany({})).toHaveLength(2);
});

test('transactions run one after another', async () => {
  const { database, hints } = setup();
  const order: string[] = [];
  const run = (name: string) =>
    database.transaction(async () => {
      order.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await hints.create({ id: name });
      order.push(`${name} end`);
    });
  await Promise.all([run('a'), run('b')]);
  expect(order).toEqual(['a start', 'a end', 'b start', 'b end']);
});

test('a transaction inside one is a savepoint: its failure undoes it alone', async () => {
  const { database, hints } = setup();
  await database.transaction(async () => {
    await hints.create({ id: 'outer' });
    await database
      .transaction(async () => {
        await hints.create({ id: 'inner' });
        throw new Error('inner stop');
      })
      .catch(() => {});
  });
  expect((await hints.findMany({})).map((hint) => hint.id)).toEqual(['outer']);
});
