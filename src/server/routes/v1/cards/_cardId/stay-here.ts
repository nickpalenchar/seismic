import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner keeps the idea's work in the repository it is in. Answered with the card. */
export class StayHere extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/stay-here';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'stayHere' }) });
}
