import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner keeps the cards of a proposed merge apart. Answered with the card. */
export class Separate extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/separate';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'separate' });
}
