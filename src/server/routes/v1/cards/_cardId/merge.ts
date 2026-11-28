import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner merges the card with the card `with`. Answered with the card. */
export class Merge extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/merge';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (typeof body.with !== 'string') throw new BadRequest('invalid', 'with must name the card to merge with');
    return { card: await this.cardService.performAction(request.params.cardId!, { action: 'merge', with: body.with }) };
  };
}
