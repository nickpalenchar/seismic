import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** A deleted card brought back (the undo of its deletion), with its workstation where that is still free; answered with the card. */
export class Restore extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/restore';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!, { deleted: true });
    const cardId = request.params.cardId!;
    project.restore(cardId);
    const card = project.board.item(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    return { card };
  };
}
