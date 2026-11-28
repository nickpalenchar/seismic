import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** A finished or stopped card (or a parked or dropped idea) taken off the project into the archive; answered with the card as the archive shows it. */
export class Archive extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/archive';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.getProjectRuntimeForCard(request);
    const cardId = request.params.cardId!;
    project.board.archive([cardId]);
    const card = project.board.card(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    return { card };
  };
}
