import type { CardService } from '../../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../../httpRoute';

/** The owner removes the arrow they drew from the card to `:toCardId`. */
export class Dependency extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/dependencies/:toCardId';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override DELETE = async (request: RouteRequest): Promise<void> => {
    (await this.cardService.getProjectRuntimeForCard(request.params.cardId!)).board.connect(request.params.cardId!, request.params.toCardId!, true);
  };
}
