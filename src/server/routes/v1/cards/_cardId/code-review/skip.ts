import type { Item } from '../../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../../httpRoute';

/** The owner goes on without the code review the card's work waits on. Answered with the card. */
export class SkipCodeReview extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/code-review/skip';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'skipCodeReview' });
}
