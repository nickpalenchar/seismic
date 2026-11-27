import { BadRequest } from '../../../../../../../board';
import type { Item } from '../../../../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../../../../httpRoute';

/** The owner reopens an item (a finding) of the card's code review. Answered with the card. */
export class ReopenReviewItem extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/code-review/items/:itemNumber/reopen';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => {
    const number = Number(request.params.itemNumber);
    if (!Number.isSafeInteger(number)) throw new BadRequest('invalid', 'the item must be a number');
    return this.runCardAction(request, { action: 'reopenReviewItem', number });
  };
}
