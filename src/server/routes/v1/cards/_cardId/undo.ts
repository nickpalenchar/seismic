import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner discards the changes the card's worker made in the project's folder: what can be put back is, and the card's log says what was not. Answered with the card. */
export class Undo extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/undo';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => ({ card: await this.cardService.performAction(request.params.cardId!, { action: 'undo' }) });
}
