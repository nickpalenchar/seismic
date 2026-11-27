import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner sends the comments held back for the card's worker (`now`: at once, not after the moment given to an approval). Answered with the card. */
export class Release extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/release';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (body.now !== undefined && typeof body.now !== 'boolean') throw new BadRequest('invalid', 'now must be true or false');
    return this.runCardAction(request, { action: 'release', ...(body.now ? { now: true } : {}) });
  };
}
