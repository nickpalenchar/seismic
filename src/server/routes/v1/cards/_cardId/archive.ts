import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** A finished or stopped card (or a parked or dropped idea) taken off the project into the archive; answered with the card as the archive shows it. */
export class Archive extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/archive';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const cardId = request.params.cardId!;
    project.board.archive([cardId]);
    const card = project.board.card(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    return { card };
  };
}
