import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner stops the card's agent: the card is planned again, its workstation kept where it holds work. Answered with the card. */
export class Stop extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/stop';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = this.getProjectRuntimeForCard(request);
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'stop' });
    return { card: this.dependencies.cards.getCard(cardId)! };
  };
}
