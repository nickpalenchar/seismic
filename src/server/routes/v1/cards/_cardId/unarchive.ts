import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** An archived card back on the project (the archive's "Unarchive", and the undo of archiving it); answered with the card. */
export class Unarchive extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/unarchive';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.getProjectRuntimeForCard(request);
    const cardId = request.params.cardId!;
    project.board.unarchive(cardId);
    const card = project.board.item(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    return { card };
  };
}
