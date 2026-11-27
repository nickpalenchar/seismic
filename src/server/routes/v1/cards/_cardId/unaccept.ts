import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner takes back accepting the proposal, while it has not started. Answered with the card. */
export class Unaccept extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/unaccept';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'unaccept' });
}
