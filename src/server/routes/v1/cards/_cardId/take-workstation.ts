import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner lets the card take the workstation another card holds. Answered with the card. */
export class TakeWorkstation extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/take-workstation';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'takeWorkstation' });
}
