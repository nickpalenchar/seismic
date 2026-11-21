import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** A deleted card brought back (the undo of its deletion), with its workstation where that is still free; answered with the card. */
export class Restore extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/restore';

  override POST = (request: RouteRequest): { card: Item } => {
    const project = this.projectOfCard(request, { deleted: true });
    const cardId = request.params.cardId!;
    project.restore(cardId);
    const card = project.board.item(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    return { card };
  };
}
