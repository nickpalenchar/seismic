import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner lets the paused agent of the card go on, or the card that hit its retry limit try again. Answered with the card. */
export class Resume extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/resume';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = this.projectOfCard(request);
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'resume' });
    return { card: project.board.card(cardId)! };
  };
}
