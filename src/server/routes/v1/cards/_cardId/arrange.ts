import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner has the plan's workstreams put in columns by what builds on what. Answered with the card. */
export class Arrange extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/arrange';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'arrange' }) });
}
