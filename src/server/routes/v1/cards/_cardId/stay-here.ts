import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner keeps the idea's work in the repository it is in. Answered with the card. */
export class StayHere extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/stay-here';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'stayHere' });
}
