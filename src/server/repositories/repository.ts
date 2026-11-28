import { cacheKey } from './cache/cacheKey';
import { TimeToLiveCache } from './cache/timeToLiveCache';
import type { DatabaseProvider } from './databaseProvider';

const DEFAULT_CACHE_MAX_KEYS = 1000;
const DEFAULT_CACHE_TIME_TO_LIVE_MILLISECONDS = 60_000;

export interface RepositoryOptions {
  cacheMaxKeys?: number;
  cacheTimeToLiveMilliseconds?: number;
  now?: () => number;
}

/**
 * What a repository reads and writes: the query side of one kind of record. Services ask repositories,
 * never the database. The reads are cached in memory; a write evicts what it touches before it answers.
 *
 * A subclass implements `idOf` and the `…Uncached` methods, which do the database work: each is the
 * method of the same name without it (`findUncached` for `find`), reading or writing the one record,
 * or the several. This class adds the cache around them. Records are shared between callers once
 * cached, so they must be immutable.
 *
 * There is one repository of each class per database: it holds the cache, so a second would go stale
 * on the first one's writes. The `DatabaseProvider` refuses a second, and each owner hands its one
 * to whoever needs it.
 *
 * The repositories share a `DatabaseProvider`: a read or write waits while a transaction is open that
 * the caller is not in, a read inside a transaction is not cached, and a rollback drops the cache.
 *
 * The options: `cacheMaxKeys` is how many keys each of the two caches (single records, query results)
 * holds, 1000 by default; `cacheTimeToLiveMilliseconds` is how long a read stays good, a minute by
 * default, and 0 turns the cache off; `now` is for a test to set.
 *
 * A query's `ids` list is a set: `{ ids: [4, 1, 3] }` and `{ ids: [1, 3, 4] }` hit one cache entry, and
 * `findMany` makes no promise about the order of its records. Other list fields in a query keep their
 * order in the key; a subclass names more set-like fields in `unorderedQueryFields`.
 */
export abstract class Repository<Record, Id extends string | number, Create extends object, Change extends object, Query extends object = { ids?: Id[] }> {
  protected readonly unorderedQueryFields: readonly string[] = ['ids'];
  private readonly records: TimeToLiveCache<Record | undefined>;
  private readonly results: TimeToLiveCache<Record[]>;
  private writes = 0;

  constructor(
    protected readonly database: DatabaseProvider,
    options: RepositoryOptions = {},
  ) {
    database.claim(new.target);
    database.onRollback(() => this.evictAll());
    const cache = {
      maxKeys: options.cacheMaxKeys ?? DEFAULT_CACHE_MAX_KEYS,
      timeToLiveMilliseconds: options.cacheTimeToLiveMilliseconds ?? DEFAULT_CACHE_TIME_TO_LIVE_MILLISECONDS,
      ...(options.now ? { now: options.now } : {}),
    };
    this.records = new TimeToLiveCache(cache);
    this.results = new TimeToLiveCache(cache);
  }

  protected abstract idOf(record: Record): Id;
  protected abstract findUncached(id: Id): Promise<Record | undefined>;
  protected abstract findManyUncached(query: Query): Promise<Record[]>;
  protected abstract createUncached(input: Create): Promise<Record>;
  protected abstract createManyUncached(inputs: Create[]): Promise<Record[]>;
  protected abstract updateUncached(id: Id, change: Change): Promise<Record | undefined>;
  protected abstract updateManyUncached(ids: Id[], change: Change): Promise<Record[]>;
  protected abstract deleteUncached(id: Id): Promise<boolean>;
  protected abstract deleteManyUncached(ids: Id[]): Promise<number>;

  /** The record with this id; none for an unknown id. */
  async find(id: Id): Promise<Record | undefined> {
    const key = String(id);
    const cached = this.records.get(key);
    if (cached) return cached.value;
    await this.database.whenAvailable();
    const writesBefore = this.writes;
    const record = await this.findUncached(id);
    if (writesBefore === this.writes && !this.database.inTransaction) this.records.set(key, record);
    return record;
  }

  /** The records that match the query. */
  async findMany(query: Query): Promise<Record[]> {
    const key = cacheKey(query, this.unorderedQueryFields);
    const cached = this.results.get(key);
    if (cached) return [...cached.value];
    await this.database.whenAvailable();
    const writesBefore = this.writes;
    const records = await this.findManyUncached(query);
    if (writesBefore === this.writes && !this.database.inTransaction) this.results.set(key, [...records]);
    return records;
  }

  /** Stores a new record. */
  create(input: Create): Promise<Record> {
    return this.write(() => this.createUncached(input), (record) => [this.idOf(record)]);
  }

  /** Stores new records, together. */
  createMany(inputs: Create[]): Promise<Record[]> {
    return this.write(() => this.createManyUncached(inputs), (records) => records.map((record) => this.idOf(record)));
  }

  /** Changes the record with this id; the record as it then stands, none for an unknown id. */
  update(id: Id, change: Change): Promise<Record | undefined> {
    return this.write(() => this.updateUncached(id, change), () => [id]);
  }

  /** Changes the records with these ids the same way; those that exist, as they then stand. */
  updateMany(ids: Id[], change: Change): Promise<Record[]> {
    return this.write(() => this.updateManyUncached(ids, change), () => ids);
  }

  /** Removes the record with this id; whether there was one. */
  delete(id: Id): Promise<boolean> {
    return this.write(() => this.deleteUncached(id), () => [id]);
  }

  /** Removes the records with these ids; how many there were. */
  deleteMany(ids: Id[]): Promise<number> {
    return this.write(() => this.deleteManyUncached(ids), () => ids);
  }

  /**
   * The record with this id, stored from `input` first when there is none. The default is a find and
   * then a create, which two callers at once can both lose; a repository whose table can do better
   * (an insert that ignores a conflict) overrides it.
   */
  async findOrCreate(id: Id, input: Create): Promise<Record> {
    return (await this.find(id)) ?? this.create(input);
  }

  /** Drops the cached record with this id, and every cached query result, since any may hold it. Await it to be sure the next read goes to the database. */
  async uncacheById(id: Id): Promise<void> {
    this.evict([id]);
  }

  /** Drops everything this repository has cached. */
  async uncacheAll(): Promise<void> {
    this.evictAll();
  }

  /** Runs a write and evicts what it touched, before it answers; a read that began before the write does not refill the cache with what it read. A failed write drops the whole cache, since it may have changed some of what it was meant to. */
  protected async write<Result>(run: () => Promise<Result>, touchedIds: (result: Result) => Id[]): Promise<Result> {
    await this.database.whenAvailable();
    this.writes += 1;
    try {
      const result = await run();
      this.writes += 1;
      this.evict(touchedIds(result));
      return result;
    } catch (error) {
      this.writes += 1;
      this.evictAll();
      throw error;
    }
  }

  /** A write this class did not run itself (one by code that still reaches the table directly, and must say so): drops what is cached of these ids, or with `'many'` everything. */
  protected noteWrite(ids: Id[] | 'many'): void {
    this.writes += 2;
    if (ids === 'many') this.evictAll();
    else this.evict(ids);
  }

  private evict(ids: Id[]): void {
    for (const id of ids) this.records.delete(String(id));
    this.results.clear();
  }

  private evictAll(): void {
    this.records.clear();
    this.results.clear();
  }
}
