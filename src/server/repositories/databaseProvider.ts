import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from '../schemas/common';

interface TransactionScope {
  savepoints: number;
}

/**
 * The connection to the database that the repositories share, and the transactions across them.
 *
 * `transaction` runs an async function between BEGIN and COMMIT and settles once the commit (or the
 * rollback) is done. Calls the function makes to repositories, however deep, are inside it. One
 * transaction is open at a time; another that is asked for waits its turn, and so does any repository
 * call from outside it, so nothing outside reads or writes what the open one has not committed.
 * Code that still reaches the connection directly (`Store`) is not held back: keep what a
 * transaction awaits to repository calls, with no waiting on I/O, so that it is over in the
 * microtasks that follow.
 */
export class DatabaseProvider {
  private readonly scope = new AsyncLocalStorage<TransactionScope>();
  private open: Promise<void> | undefined;
  private readonly rollbackListeners = new Set<() => void>();

  private readonly claimed = new Set<Function>();

  constructor(readonly orm: Db) {}

  /**
   * Makes the calling repository the one of its class for this database; a second of the same class is
   * refused. Each keeps its own cache, so two of a kind would serve stale records after the other's
   * writes: a repository is a singleton per database, and whoever needs it is handed that one.
   */
  claim(repository: Function): void {
    if (this.claimed.has(repository)) throw new Error(`${repository.name} exists for this database already: ask for the one that does`);
    this.claimed.add(repository);
  }

  /** Whether the caller is inside a transaction of this provider: what it reads may still be rolled back, so a repository does not cache it. */
  get inTransaction(): boolean {
    return this.scope.getStore() !== undefined;
  }

  /** Calls `listener` when a transaction rolls back, so a repository can drop what it cached during it. Gives the function that stops the calls. */
  onRollback(listener: () => void): () => void {
    this.rollbackListeners.add(listener);
    return () => this.rollbackListeners.delete(listener);
  }

  /** Settles when no transaction is open, or at once for a caller inside the open one. Repositories await it before they read or write. */
  async whenAvailable(): Promise<void> {
    while (this.open && !this.inTransaction) await this.open;
  }

  /**
   * Runs `fn` in a transaction: committed when it resolves, rolled back when it rejects. The result
   * settles after the commit. Inside a transaction already, `fn` runs in a savepoint of it.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const enclosing = this.scope.getStore();
    if (enclosing) return this.savepoint(enclosing, fn);
    while (this.open) await this.open;
    let release!: () => void;
    this.open = new Promise<void>((resolve) => (release = resolve));
    const client = this.orm.$client;
    try {
      client.run('BEGIN IMMEDIATE');
      let result: T;
      try {
        result = await this.scope.run({ savepoints: 0 }, fn);
      } catch (error) {
        client.run('ROLLBACK');
        this.notifyRollback();
        throw error;
      }
      client.run('COMMIT');
      return result;
    } finally {
      this.open = undefined;
      release();
    }
  }

  private async savepoint<T>(scope: TransactionScope, fn: () => Promise<T>): Promise<T> {
    const client = this.orm.$client;
    const name = `repository_savepoint_${++scope.savepoints}`;
    client.run(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      client.run(`RELEASE ${name}`);
      return result;
    } catch (error) {
      client.run(`ROLLBACK TO ${name}`);
      client.run(`RELEASE ${name}`);
      this.notifyRollback();
      throw error;
    }
  }

  private notifyRollback(): void {
    for (const listener of this.rollbackListeners) listener();
  }
}
