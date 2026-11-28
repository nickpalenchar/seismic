import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner takes back accepting the proposal, while it has not started. Answered with the card. */
export class Unaccept extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/unaccept';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'unaccept' }) });
}
