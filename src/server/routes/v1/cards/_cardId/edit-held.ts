import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner rewrites the pull request comment a review card holds back for the contributor (`body`). Answered with the card. */
export class EditHeld extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/edit-held';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const { body } = await this.bodyOf(request);
    if (typeof body !== 'string') throw new BadRequest('invalid', 'body must be text');
    return this.pressCard(request, { action: 'editHeld', body });
  };
}
