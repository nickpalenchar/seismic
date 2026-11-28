import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner parks the card (an idea is shelved, any other card goes to the parking lot). Answered with the card. */
export class Park extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/park';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'park' }) });
}
