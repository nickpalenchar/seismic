export interface TimeToLiveCacheOptions {
  maxKeys: number;
  timeToLiveMilliseconds: number;
  now?: () => number;
}

interface Entry<Value> {
  value: Value;
  expiresAt: number;
}

/**
 * An in-memory store of values by key, bounded in size and in age: the cache of a repository. Past
 * `maxKeys` the entry used least recently goes; an entry lives `timeToLiveMilliseconds`; `now` (in
 * milliseconds) is for a test to set.
 */
export class TimeToLiveCache<Value> {
  private readonly entries = new Map<string, Entry<Value>>();
  private readonly now: () => number;

  constructor(private readonly options: TimeToLiveCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  /** The entry for `key`, wrapped so that a cached `undefined` can be told from a miss; an entry past its age is evicted here, and reads as a miss. */
  get(key: string): { value: Value } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value };
  }

  /** Keeps `value` under `key` for the age of the cache; at the size limit, the entry used least recently goes first. */
  set(key: string, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.options.timeToLiveMilliseconds });
    if (this.entries.size > this.options.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /** Drops the entry under `key`, if any. */
  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drops every entry. */
  clear(): void {
    this.entries.clear();
  }

  /** How many entries are held, expired ones included until something reads them. */
  get size(): number {
    return this.entries.size;
  }
}
