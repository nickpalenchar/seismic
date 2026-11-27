import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner has the idea built (`agent`: the one that builds). Answered with the card. */
export class Build extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/build';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (body.agent !== undefined && (typeof body.agent !== 'object' || body.agent === null || Array.isArray(body.agent))) throw new BadRequest('invalid', 'agent must be an agent setting');
    return this.pressCard(request, { ...body, action: 'build' } as CardAction);
  };
}
