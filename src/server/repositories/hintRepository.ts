import { eq, inArray } from 'drizzle-orm';
import { now } from '../schemas/common';
import { seenHints } from '../schemas/seenHints';
import type { DatabaseProvider } from './databaseProvider';
import { Repository, type RepositoryOptions } from './repository';

/** A hint the owner has seen, and when. */
export class SeenHint {
  constructor(
    readonly id: string,
    readonly seenAt: string,
  ) {
    Object.freeze(this);
  }
}

interface SeenHintCreate {
  id: string;
}

interface SeenHintChange {
  seenAt: string;
}

/** The hints the owner has seen, in the `seen_hints` table. */
export class HintRepository extends Repository<SeenHint, string, SeenHintCreate, SeenHintChange> {
  constructor(database: DatabaseProvider, options?: RepositoryOptions) {
    super(database, options);
  }

  private get db() {
    return this.database.orm;
  }

  protected override idOf(record: SeenHint): string {
    return record.id;
  }

  protected override async findUncached(id: string): Promise<SeenHint | undefined> {
    return this.asRecord(this.db.select().from(seenHints).where(eq(seenHints.id, id)).get());
  }

  protected override async findManyUncached(query: { ids?: string[] }): Promise<SeenHint[]> {
    const rows = query.ids ? this.db.select().from(seenHints).where(inArray(seenHints.id, query.ids)).all() : this.db.select().from(seenHints).all();
    return rows.map((row) => new SeenHint(row.id, row.seenAt));
  }

  protected override async createUncached(input: SeenHintCreate): Promise<SeenHint> {
    const [record] = await this.createManyUncached([input]);
    return record!;
  }

  protected override async createManyUncached(inputs: SeenHintCreate[]): Promise<SeenHint[]> {
    const seenAt = now();
    return this.db
      .insert(seenHints)
      .values(inputs.map((input) => ({ id: input.id, seenAt })))
      .returning()
      .all()
      .map((row) => new SeenHint(row.id, row.seenAt));
  }

  protected override async updateUncached(id: string, change: SeenHintChange): Promise<SeenHint | undefined> {
    return this.asRecord(this.db.update(seenHints).set(change).where(eq(seenHints.id, id)).returning().get());
  }

  protected override async updateManyUncached(ids: string[], change: SeenHintChange): Promise<SeenHint[]> {
    return this.db
      .update(seenHints)
      .set(change)
      .where(inArray(seenHints.id, ids))
      .returning()
      .all()
      .map((row) => new SeenHint(row.id, row.seenAt));
  }

  protected override async deleteUncached(id: string): Promise<boolean> {
    return (await this.deleteManyUncached([id])) > 0;
  }

  protected override async deleteManyUncached(ids: string[]): Promise<number> {
    return this.db.delete(seenHints).where(inArray(seenHints.id, ids)).returning({ id: seenHints.id }).all().length;
  }

  /** The hint as seen, stored now when it was not; one seen already keeps the time it was first seen, and two callers at once do not collide. */
  override async findOrCreate(id: string, input: SeenHintCreate): Promise<SeenHint> {
    await this.write(async () => {
      this.db.insert(seenHints).values({ id: input.id, seenAt: now() }).onConflictDoNothing().run();
      return [];
    }, () => [id]);
    return (await this.find(id))!;
  }

  private asRecord(row: { id: string; seenAt: string } | undefined): SeenHint | undefined {
    return row && new SeenHint(row.id, row.seenAt);
  }
}
