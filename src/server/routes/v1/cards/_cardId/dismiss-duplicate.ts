import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner dismisses the hint that the card duplicates another. Answered with the card. */
export class DismissDuplicate extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/dismiss-duplicate';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'dismissDuplicate' });
}
