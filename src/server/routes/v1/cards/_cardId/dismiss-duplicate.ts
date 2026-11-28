import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner dismisses the hint that the card duplicates another. Answered with the card. */
export class DismissDuplicate extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/dismiss-duplicate';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'dismissDuplicate' }) });
}
