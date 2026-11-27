import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner turns the Question card into an idea. Answered with the card. */
export class AsIdea extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/as-idea';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'asIdea' });
}
