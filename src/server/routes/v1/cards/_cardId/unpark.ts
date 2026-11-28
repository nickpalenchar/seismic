import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner takes the card out of the parking lot. Answered with the card. */
export class Unpark extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/unpark';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'unpark' }) });
}
