/**
 * The short tags (`K1`, `K2`…) a session calls cards by, and back: what an agent is told of cards,
 * and what it reports of them, goes by tag, so it never handles a card's id.
 */
import type { Item } from '../../../../core/types';

export class CardTags {
  private readonly byTag = new Map<string, string>();
  private readonly byId = new Map<string, string>();

  /** Tags the cards of the lists in their order; a card in several lists keeps its first tag. */
  constructor(...lists: Item[][]) {
    for (const card of lists.flat()) {
      if (this.byId.has(card.id)) continue;
      const tag = `K${this.byId.size + 1}`;
      this.byId.set(card.id, tag);
      this.byTag.set(tag, card.id);
    }
  }

  /** The id of the card a tag names; none for a tag the session made up. */
  idOf(tag: string): string | undefined {
    return this.byTag.get(tag);
  }

  /** The tag of a card that was among those tagged. */
  tagOf(id: string): string {
    const tag = this.byId.get(id);
    if (!tag) throw new Error(`card ${id} has no tag`);
    return tag;
  }
}
