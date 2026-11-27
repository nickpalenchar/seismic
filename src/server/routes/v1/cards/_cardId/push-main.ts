import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner pushes a contributor's change of a review card onto main. Answered with the card. */
export class PushMain extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/push-main';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'pushMain' });
}
