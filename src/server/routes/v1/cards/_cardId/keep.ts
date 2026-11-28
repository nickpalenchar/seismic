import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner keeps the superseded card. Answered with the card. */
export class Keep extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/keep';

  constructor(
    dependencies: RouteDependencies,
    private readonly cardService: CardService,
  ) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'keep' }) });
}
