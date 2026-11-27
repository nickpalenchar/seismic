import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** Seismic names the card from what it says. Answered with the card. */
export class Name extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/name';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'name' });
}
