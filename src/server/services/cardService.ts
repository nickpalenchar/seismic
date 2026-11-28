import type { CardAction, Item } from '../../core/types';
import { BadRequest } from '../board';
import { NotFound } from '../notFound';
import type { ProjectRuntime } from '../project';
import type { CardRepository } from '../repositories/cardRepository';

/**
 * What is known of cards across the projects that run: which project each belongs to. A card that
 * is not found, or is deleted, is refused with `NotFound`. There is one of these, with the one
 * `CardRepository`, for the whole server.
 */
export class CardService {
  constructor(
    private readonly cardRepository: CardRepository,
    private readonly projects: () => ProjectRuntime[],
  ) {}

  /** The project the card is on; a deleted card counts only when `deleted`. */
  async getProjectRuntimeForCard(cardId: string, { deleted = false }: { deleted?: boolean } = {}): Promise<ProjectRuntime> {
    const card = await this.cardRepository.find(cardId);
    const project = card && (!card.deleted_at || deleted) ? this.projects().find((candidate) => candidate.id === card.project_id) : undefined;
    if (!project) throw new NotFound('unknownCard', 'unknown card');
    return project;
  }

  /** The project of the first of the cards (a list of card ids), which a call about several keeps to one project; an empty list, or an unknown card, is refused. */
  async getProjectRuntimeForCards(cardIds: unknown): Promise<ProjectRuntime> {
    if (!Array.isArray(cardIds) || !cardIds.every((id) => typeof id === 'string')) throw new BadRequest('invalid', 'cards must be a list of card ids');
    const [first] = cardIds;
    if (first === undefined) throw new BadRequest('invalid', 'a card is needed');
    return this.getProjectRuntimeForCard(first);
  }

  /** The owner's action on the card, run as a click; the card as it then stands. */
  async performAction(cardId: string, action: CardAction): Promise<Item> {
    const project = await this.getProjectRuntimeForCard(cardId);
    await project.press(cardId, action);
    const card = project.board.card(cardId);
    if (!card) throw new NotFound('unknownCard', 'unknown card');
    return card;
  }
}
