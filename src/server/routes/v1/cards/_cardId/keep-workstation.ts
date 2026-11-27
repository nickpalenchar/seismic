import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner keeps the workstation the card holds, against one that wants it. Answered with the card. */
export class KeepWorkstation extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/keep-workstation';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'keepWorkstation' });
}
