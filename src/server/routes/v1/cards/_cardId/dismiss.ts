import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner dismisses the proposal (or a superseded card), which removes it. Answered with the card. */
export class Dismiss extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/dismiss';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'dismiss' }) });
}
