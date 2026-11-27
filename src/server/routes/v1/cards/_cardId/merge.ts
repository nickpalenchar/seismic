import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner merges the card with the card `with`. Answered with the card. */
export class Merge extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/merge';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (typeof body.with !== 'string') throw new BadRequest('invalid', 'with must name the card to merge with');
    return this.pressCard(request, { action: 'merge', with: body.with });
  };
}
