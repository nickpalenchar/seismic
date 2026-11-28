import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner snoozes the card until `until` (a time within the coming year); it comes back then. Answered with the card. */
export class Snooze extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/snooze';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const { until } = await this.bodyOf(request);
    if (typeof until !== 'string') throw new BadRequest('invalid', 'until must be a time');
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'snooze', until });
    return { card: project.board.card(cardId)! };
  };
}
