import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner approves the merge proposed for the card. Answered with the card. */
export class ApproveMerge extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/approve-merge';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'approveMerge' }) });
}
