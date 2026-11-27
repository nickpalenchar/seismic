import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner keeps the superseded card. Answered with the card. */
export class Keep extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/keep';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'keep' });
}
