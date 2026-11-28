import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner takes back words they said on the card (`id`: the event), while its agent has not read them. Answered with the card. */
export class Unsay extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/unsay';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (!Number.isInteger(body.id)) throw new BadRequest('invalid', 'id must name what was said');
    return { card: await this.cardService.performAction(request.params.cardId!, { action: 'unsay', id: body.id as number }) };
  };
}
