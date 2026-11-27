import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner moves the card in the queue (`earlier`: toward the front, by `places`, one by default). Answered with the card. */
export class Reorder extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/reorder';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (typeof body.earlier !== 'boolean') throw new BadRequest('invalid', 'earlier must be true or false');
    if (body.places !== undefined && !Number.isInteger(body.places)) throw new BadRequest('invalid', 'places must be a whole number');
    return this.pressCard(request, { ...body, action: 'reorder' } as CardAction);
  };
}
