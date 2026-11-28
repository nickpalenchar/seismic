import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner rewrites the pull request comment a review card holds back for the contributor (`body`). Answered with the card. */
export class EditHeld extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/edit-held';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const { body } = await this.bodyOf(request);
    if (typeof body !== 'string') throw new BadRequest('invalid', 'body must be text');
    return { card: await this.cardService.performAction(request.params.cardId!, { action: 'editHeld', body }) };
  };
}
