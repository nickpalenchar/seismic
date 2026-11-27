import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner parks the card (an idea is shelved, any other card goes to the parking lot). Answered with the card. */
export class Park extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/park';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'park' });
}
