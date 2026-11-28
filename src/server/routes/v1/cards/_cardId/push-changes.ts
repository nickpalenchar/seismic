import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner sends the review card's held changes to the contributor's pull request. Answered with the card. */
export class PushChanges extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/push-changes';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'pushChanges' }) });
}
