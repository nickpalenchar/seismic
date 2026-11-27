import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner turns the idea into a plan doc. Answered with the card. */
export class PlanDoc extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/plan-doc';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.pressCard(request, { action: 'planDoc' });
}
