import type { Item } from '../../core/types';
import type { ProjectRuntime } from '../project';

/** What is known of cards across the projects that run: which project each belongs to. */
export class CardService {
  constructor(private readonly projects: () => ProjectRuntime[]) {}

  /** The project the card is on; none for an unknown card, or a deleted one unless `deleted`. */
  getProjectRuntimeForCard(cardId: string, { deleted = false }: { deleted?: boolean } = {}): ProjectRuntime | undefined {
    return this.projects().find((project) => {
      const row = project.dataStore.cards.get(cardId);
      return row?.project_id === project.id && (!row.deleted_at || deleted);
    });
  }

  /** The project of the first of the cards, which a call about several keeps to one project; none when it is unknown or there are none. */
  getProjectRuntimeForCards(cardIds: string[]): ProjectRuntime | undefined {
    return cardIds[0] === undefined ? undefined : this.getProjectRuntimeForCard(cardIds[0]);
  }

  /** The card as its project shows it; none for an unknown or deleted one. */
  getCard(cardId: string): Item | undefined {
    return this.getProjectRuntimeForCard(cardId)?.board.card(cardId);
  }
}
