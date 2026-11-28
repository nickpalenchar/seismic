import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner pushes a contributor's change of a review card onto main. Answered with the card. */
export class PushMain extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/push-main';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'pushMain' }) });
}
