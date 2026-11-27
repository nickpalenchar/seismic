import { expect, test } from 'bun:test';
import { cacheKey } from '../../repositories/cache/cacheKey';
import { TimeToLiveCache } from '../../repositories/cache/timeToLiveCache';
import { Repository, type RepositoryOptions } from '../../repositories/repository';

interface Note {
  id: number;
  text: string;
}

/** A repository over a map that counts its reads, so a test sees which ones the cache answered. */
class NoteRepository extends Repository<Note, number, { id: number; text: string }, { text: string }> {
  readonly table = new Map<number, Note>();
  reads = 0;
  beforeRead?: () => Promise<void>;

  constructor(options?: RepositoryOptions) {
    super(options);
  }

  protected override idOf(note: Note) {
    return note.id;
  }
  protected override async findUncached(id: number) {
    this.reads++;
    const note = this.table.get(id);
    await this.beforeRead?.();
    return note;
  }
  protected override async findManyUncached(query: { ids?: number[] }) {
    this.reads++;
    return [...this.table.values()].filter((note) => !query.ids || query.ids.includes(note.id));
  }
  protected override async createUncached(input: Note) {
    this.table.set(input.id, input);
    return input;
  }
  protected override async createManyUncached(inputs: Note[]) {
    return Promise.all(inputs.map((input) => this.createUncached(input)));
  }
  protected override async updateUncached(id: number, change: { text: string }) {
    const note = this.table.get(id);
    if (!note) return undefined;
    const changed = { ...note, ...change };
    this.table.set(id, changed);
    return changed;
  }
  protected override async updateManyUncached(ids: number[], change: { text: string }) {
    const changed = await Promise.all(ids.map((id) => this.updateUncached(id, change)));
    return changed.filter((note): note is Note => !!note);
  }
  protected override async deleteUncached(id: number) {
    return this.table.delete(id);
  }
  protected override async deleteManyUncached(ids: number[]) {
    return ids.filter((id) => this.table.delete(id)).length;
  }
}

test('a find is answered from the cache until its age is up, then goes to the database again', async () => {
  let time = 0;
  const notes = new NoteRepository({ now: () => time });
  await notes.create({ id: 1, text: 'a' });
  await notes.find(1);
  await notes.find(1);
  expect(notes.reads).toBe(1);
  time = 59_999;
  await notes.find(1);
  expect(notes.reads).toBe(1);
  time = 60_000;
  await notes.find(1);
  expect(notes.reads).toBe(2);
});

test('a write to a record is seen by the next find', async () => {
  const notes = new NoteRepository();
  await notes.create({ id: 1, text: 'a' });
  expect((await notes.find(1))?.text).toBe('a');
  await notes.update(1, { text: 'b' });
  expect((await notes.find(1))?.text).toBe('b');
  await notes.delete(1);
  expect(await notes.find(1)).toBeUndefined();
});

test('an unknown id is cached too, and a create replaces it', async () => {
  const notes = new NoteRepository();
  expect(await notes.find(7)).toBeUndefined();
  expect(await notes.find(7)).toBeUndefined();
  expect(notes.reads).toBe(1);
  await notes.create({ id: 7, text: 'x' });
  expect((await notes.find(7))?.text).toBe('x');
});

test('findMany shares one cache entry between the same ids in any order', async () => {
  const notes = new NoteRepository();
  await notes.createMany([1, 3, 4, 5].map((id) => ({ id, text: String(id) })));
  const first = await notes.findMany({ ids: [4, 1, 3] });
  const second = await notes.findMany({ ids: [1, 3, 4] });
  expect(notes.reads).toBe(1);
  expect(second.map((note) => note.id)).toEqual(first.map((note) => note.id));
});

test('a write drops the cached query results, which may hold the record', async () => {
  const notes = new NoteRepository();
  await notes.createMany([1, 2].map((id) => ({ id, text: 'a' })));
  await notes.findMany({ ids: [1, 2] });
  await notes.update(2, { text: 'b' });
  expect((await notes.findMany({ ids: [1, 2] })).find((note) => note.id === 2)?.text).toBe('b');
  expect(notes.reads).toBe(2);
});

test('the list a find returns can be changed without changing the cached one', async () => {
  const notes = new NoteRepository();
  await notes.create({ id: 1, text: 'a' });
  (await notes.findMany({})).pop();
  expect(await notes.findMany({})).toHaveLength(1);
});

test('a read that began before a write does not put what it read into the cache', async () => {
  const notes = new NoteRepository();
  await notes.create({ id: 1, text: 'old' });
  notes.beforeRead = async () => {
    notes.beforeRead = undefined;
    await notes.update(1, { text: 'new' });
  };
  expect((await notes.find(1))?.text).toBe('old');
  expect((await notes.find(1))?.text).toBe('new');
});

test('uncacheById and uncacheAll make the next read go to the database', async () => {
  const notes = new NoteRepository();
  await notes.createMany([1, 2].map((id) => ({ id, text: 'a' })));
  await notes.find(1);
  await notes.find(2);
  notes.table.set(1, { id: 1, text: 'changed behind its back' });
  await notes.uncacheById(1);
  expect((await notes.find(1))?.text).toBe('changed behind its back');
  notes.table.set(2, { id: 2, text: 'also' });
  expect((await notes.find(2))?.text).toBe('a');
  await notes.uncacheAll();
  expect((await notes.find(2))?.text).toBe('also');
});

test('findOrCreate finds the record, or stores it', async () => {
  const notes = new NoteRepository();
  expect((await notes.findOrCreate(1, { id: 1, text: 'first' })).text).toBe('first');
  expect((await notes.findOrCreate(1, { id: 1, text: 'second' })).text).toBe('first');
});

test('the cache holds no more keys than its limit and drops the one used least recently', () => {
  const cache = new TimeToLiveCache<number>({ maxKeys: 2, timeToLiveMilliseconds: 1000 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  expect(cache.size).toBe(2);
  expect(cache.get('b')).toBeUndefined();
  expect(cache.get('a')?.value).toBe(1);
});

test('a cache key ignores the order of a set-like list and keeps the order of any other', () => {
  expect(cacheKey({ ids: [4, 1, 3] }, ['ids'])).toBe(cacheKey({ ids: [1, 3, 4] }, ['ids']));
  expect(cacheKey({ orderBy: ['b', 'a'] }, ['ids'])).not.toBe(cacheKey({ orderBy: ['a', 'b'] }, ['ids']));
  expect(cacheKey({ b: 1, a: 2 }, [])).toBe(cacheKey({ a: 2, b: 1 }, []));
});
