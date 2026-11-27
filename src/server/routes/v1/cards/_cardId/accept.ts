import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner accepts the proposal: `start: false` only accepts it, `idea` makes it an idea, `picks` answers its questions, `agent` is the one that starts it. Answered with the card. */
export class Accept extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/accept';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    for (const key of ['start', 'idea'] as const) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new BadRequest('invalid', `${key} must be true or false`);
    if (body.picks !== undefined && !Array.isArray(body.picks)) throw new BadRequest('invalid', 'picks must be a list');
    if (body.agent !== undefined && (typeof body.agent !== 'object' || body.agent === null || Array.isArray(body.agent))) throw new BadRequest('invalid', 'agent must be an agent setting');
    return this.pressCard(request, { ...body, action: 'accept' } as CardAction);
  };
}
