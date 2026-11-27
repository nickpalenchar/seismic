import { isHintId } from '../../registries/hintRegistry';
import { BadRequest } from '../board';
import { now, type Db } from '../schemas/common';
import { seenHints } from '../schemas/seenHints';

/** Which hints the owner has seen: what the page loads once and keeps in memory. */
export class HintsService {
  constructor(private readonly db: Db) {}

  /** The ids of every hint seen, registered ones only: a stored id the registry no longer lists is left out. */
  getSeenHints(): string[] {
    return this.db
      .select({ id: seenHints.id })
      .from(seenHints)
      .all()
      .map((row) => row.id)
      .filter(isHintId);
  }

  /** Records that the hint `id` has been seen; one seen already stays as it was. An id the registry does not list is refused. */
  markHintSeen(id: string): void {
    if (!isHintId(id)) throw new BadRequest('invalid', `unknown hint "${id}"; hints are registered in src/registries/hintRegistry.ts`);
    this.db.insert(seenHints).values({ id, seenAt: now() }).onConflictDoNothing().run();
  }

  /** Brings every hint back ("Reset all hints"); gives how many had been seen. */
  resetHints(): number {
    return this.db.delete(seenHints).returning({ id: seenHints.id }).all().length;
  }
}
