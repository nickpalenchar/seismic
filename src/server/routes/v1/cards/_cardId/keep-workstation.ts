import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner keeps the workstation the card holds, against one that wants it. Answered with the card. */
export class KeepWorkstation extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/keep-workstation';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'keepWorkstation' }) });
}
