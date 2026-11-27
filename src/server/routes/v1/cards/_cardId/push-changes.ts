import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner sends the review card's held changes to the contributor's pull request. Answered with the card. */
export class PushChanges extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/push-changes';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'pushChanges' });
}
