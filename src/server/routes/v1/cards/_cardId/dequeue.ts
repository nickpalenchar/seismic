import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/**
 * "Take out of the queue": the owner takes back the card's start before its agent begins, with the
 * agent chosen for it; on a plan, the start of the workstreams not yet planned. Answered with the card.
 */
export class Dequeue extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/dequeue';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = this.projectOfCard(request);
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'dequeue' });
    return { card: project.board.card(cardId)! };
  };
}
