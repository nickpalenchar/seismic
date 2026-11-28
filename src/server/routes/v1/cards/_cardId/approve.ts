import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/**
 * The owner approves the card's work (`direct`: onto main where it would go out as a pull request).
 * The answer waits for what the approval does: the work landed, the pull request asked for, a review
 * card's PR merged, a prototype ended. So a refusal on the way (no direct push allowed, the card
 * stopped meanwhile) reaches the button; the card is answered as it then stands.
 */
export class Approve extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/approve';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const { direct } = await this.bodyOf(request);
    if (direct !== undefined && typeof direct !== 'boolean') throw new BadRequest('invalid', 'direct must be true or false');
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'approve', ...(direct ? { direct } : {}) });
    return { card: project.board.card(cardId)! };
  };
}
