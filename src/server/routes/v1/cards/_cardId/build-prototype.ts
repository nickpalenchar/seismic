import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner builds on a prototype (`workstream`: the one chosen). Answered with the card. */
export class BuildPrototype extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/build-prototype';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (body.workstream !== undefined && typeof body.workstream !== 'string') throw new BadRequest('invalid', 'workstream must be text');
    return this.runCardAction(request, { ...body, action: 'buildPrototype' } as CardAction);
  };
}
