import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner takes the card out of the parking lot. Answered with the card. */
export class Unpark extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/unpark';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'unpark' });
}
