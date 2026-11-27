import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner splits the idea off into a repository of its own. Answered with the card. */
export class SplitOff extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/split-off';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'splitOff' });
}
