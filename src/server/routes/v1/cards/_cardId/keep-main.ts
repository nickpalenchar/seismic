import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner takes a push to main back (its undo) while it can still be. Answered with the card. */
export class KeepMain extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/keep-main';

  constructor(
    dependencies: RouteDependencies,
    private readonly cardService: CardService,
  ) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'keepMain' }) });
}
