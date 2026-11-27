import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner approves the merge proposed for the card. Answered with the card. */
export class ApproveMerge extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/approve-merge';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'approveMerge' });
}
