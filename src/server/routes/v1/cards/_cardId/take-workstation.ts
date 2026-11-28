import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner lets the card take the workstation another card holds. Answered with the card. */
export class TakeWorkstation extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/take-workstation';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'takeWorkstation' }) });
}
