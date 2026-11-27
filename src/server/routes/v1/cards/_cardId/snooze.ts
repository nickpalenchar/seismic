import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner snoozes the card until `until` (a time within the coming year); it comes back then. Answered with the card. */
export class Snooze extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/snooze';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = this.projectOfCard(request);
    const { until } = await this.bodyOf(request);
    if (typeof until !== 'string') throw new BadRequest('invalid', 'until must be a time');
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'snooze', until });
    return { card: project.board.card(cardId)! };
  };
}
