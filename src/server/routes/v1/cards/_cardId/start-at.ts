import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner sets when an accepted proposal starts (`at`, a time within the coming year), or with `null` takes the time back. Answered with the card. */
export class StartAt extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/start-at';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const { at } = await this.bodyOf(request);
    if (at !== null && typeof at !== 'string') throw new BadRequest('invalid', 'at must be a time, or null');
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'startAt', at });
    return { card: project.board.card(cardId)! };
  };
}
