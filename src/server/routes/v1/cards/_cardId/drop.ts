import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner drops the idea. Answered with the card. */
export class Drop extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/drop';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'drop' });
}
