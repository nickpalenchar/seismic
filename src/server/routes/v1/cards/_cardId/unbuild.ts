import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner takes back building the idea, while it waits to start. Answered with the card. */
export class Unbuild extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/unbuild';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'unbuild' });
}
