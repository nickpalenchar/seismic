import type { Item } from '../../../../../../core/types';
import type { CardService } from '../../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../../httpRoute';

/** The owner goes on without the code review the card's work waits on. Answered with the card. */
export class SkipCodeReview extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/code-review/skip';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'skipCodeReview' }) });
}
