import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner discards the prototype. Answered with the card. */
export class Discard extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/discard';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'discard' });
}
