import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner has the plan's workstreams put in columns by what builds on what. Answered with the card. */
export class Arrange extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/arrange';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'arrange' });
}
