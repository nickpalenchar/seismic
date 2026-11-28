import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner settles a blocked card's work: `land` it onto main, or keep it as a demo only. Answered with the card. */
export class Fold extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/fold';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const { land } = await this.bodyOf(request);
    if (typeof land !== 'boolean') throw new BadRequest('invalid', 'land must be true or false');
    return { card: await this.cardService.performAction(request.params.cardId!, { action: 'fold', land }) };
  };
}
