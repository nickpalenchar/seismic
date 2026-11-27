import type { Item } from '../../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../../httpRoute';

/** The owner stops the card's code review while it runs. Answered with the card. */
export class StopCodeReview extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/code-review/stop';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'stopCodeReview' });
}
