import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner dismisses the proposal (or a superseded card), which removes it. Answered with the card. */
export class Dismiss extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/dismiss';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'dismiss' });
}
