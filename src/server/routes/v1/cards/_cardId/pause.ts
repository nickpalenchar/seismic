import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/**
 * The owner pauses the card's agent (`safePoint`: when its turn ends, not within it). Answered with
 * the card.
 */
export class Pause extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/pause';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const { safePoint } = await this.bodyOf(request);
    if (safePoint !== undefined && typeof safePoint !== 'boolean') throw new BadRequest('invalid', 'safePoint must be true or false');
    const cardId = request.params.cardId!;
    await project.press(cardId, safePoint ? { action: 'pause', safePoint: true } : { action: 'pause' });
    return { card: project.board.card(cardId)! };
  };
}
