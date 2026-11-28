import type { CardAction, Item } from '../../core/types';
import type { ProjectRuntime } from '../project';

/** What is known of cards across the projects that run: which project each belongs to. */
export class CardService {
  constructor(private readonly projects: () => ProjectRuntime[]) {}

  /** The project the card is on; none for an unknown card, or a deleted one unless `deleted`. */
  async getProjectRuntimeForCard(cardId: string, { deleted = false }: { deleted?: boolean } = {}): Promise<ProjectRuntime | undefined> {
    for (const project of this.projects()) {
      const card = await project.dataStore.cardRepository.find(cardId);
      if (card?.project_id === project.id && (!card.deleted_at || deleted)) return project;
    }
    return undefined;
  }

  /** The project of the first of the cards, which a call about several keeps to one project; none when it is unknown or there are none. */
  async getProjectRuntimeForCards(cardIds: string[]): Promise<ProjectRuntime | undefined> {
    return cardIds[0] === undefined ? undefined : this.getProjectRuntimeForCard(cardIds[0]);
  }

  /** The owner's action on the card, run as a click; the card as it then stands. None when the card is unknown. */
  async performAction(cardId: string, action: CardAction): Promise<Item | undefined> {
    const project = await this.getProjectRuntimeForCard(cardId);
    if (!project) return undefined;
    await project.press(cardId, action);
    return project.board.card(cardId);
  }

  /** The card as its project shows it; none for an unknown or deleted one. */
  async getCard(cardId: string): Promise<Item | undefined> {
    return (await this.getProjectRuntimeForCard(cardId))?.board.card(cardId);
  }
}
