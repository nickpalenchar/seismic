import type { CardService } from '../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../httpRoute';

/** The cards (`{ cards }`) leave their groups. */
export class Ungroup extends HttpRoute {
  readonly path = '/api/v1/cards/ungroup';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<void> => {
    const { cards } = await this.bodyOf(request);
    (await this.cardService.getProjectRuntimeForCards(cards)).board.group(cards, null);
  };
}
