import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner discards the prototype. Answered with the card. */
export class Discard extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/discard';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'discard' }) });
}
