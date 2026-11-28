import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner splits the idea off into a repository of its own. Answered with the card. */
export class SplitOff extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/split-off';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'splitOff' }) });
}
