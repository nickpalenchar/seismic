import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner wakes the snoozed card before its time. Answered with the card. */
export class Wake extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/wake';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.getProjectRuntimeForCard(request);
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'wake' });
    return { card: project.board.card(cardId)! };
  };
}
