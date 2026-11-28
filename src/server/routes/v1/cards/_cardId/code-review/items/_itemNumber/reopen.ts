import { BadRequest } from '../../../../../../../board';
import type { Item } from '../../../../../../../../core/types';
import type { CardService } from '../../../../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../../../../httpRoute';

/** The owner reopens an item (a finding) of the card's code review. Answered with the card. */
export class ReopenReviewItem extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/code-review/items/:itemNumber/reopen';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const number = Number(request.params.itemNumber);
    if (!Number.isSafeInteger(number)) throw new BadRequest('invalid', 'the item must be a number');
    return { card: await this.cardService.performAction(request.params.cardId!, { action: 'reopenReviewItem', number }) };
  };
}
