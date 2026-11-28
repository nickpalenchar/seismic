import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner sets when an accepted proposal starts (`at`, a time within the coming year), or with `null` takes the time back. Answered with the card. */
export class StartAt extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/start-at';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.getProjectRuntimeForCard(request);
    const { at } = await this.bodyOf(request);
    if (at !== null && typeof at !== 'string') throw new BadRequest('invalid', 'at must be a time, or null');
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'startAt', at });
    return { card: project.board.card(cardId)! };
  };
}
