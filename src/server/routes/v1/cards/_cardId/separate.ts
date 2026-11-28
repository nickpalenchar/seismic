import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner keeps the cards of a proposed merge apart. Answered with the card. */
export class Separate extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/separate';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'separate' }) });
}
