import { isHintId } from '../../registries/hintRegistry';
import { BadRequest } from '../board';
import type { HintRepository } from '../repositories/hintRepository';

/** Which hints the owner has seen: what the page loads once and keeps in memory. */
export class HintsService {
  constructor(private readonly hints: HintRepository) {}

  /** The ids of every hint seen, registered ones only: a stored id the registry no longer lists is left out. */
  async getSeenHints(): Promise<string[]> {
    const seen = await this.hints.findMany({});
    return seen.map((hint) => hint.id).filter(isHintId);
  }

  /** Records that the hint `id` has been seen; one seen already stays as it was. An id the registry does not list is refused. */
  async markHintSeen(id: string): Promise<void> {
    if (!isHintId(id)) throw new BadRequest('invalid', `unknown hint "${id}"; hints are registered in src/registries/hintRegistry.ts`);
    await this.hints.findOrCreate(id, { id });
  }

  /** Brings every hint back ("Reset all hints"); gives how many had been seen. */
  async resetHints(): Promise<number> {
    const seen = await this.hints.findMany({});
    return this.hints.deleteMany(seen.map((hint) => hint.id));
  }
}
