import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** Seismic names the card from what it says. Answered with the card. */
export class Name extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/name';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'name' }) });
}
