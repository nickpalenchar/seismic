import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner stops the card's agent: the card is planned again, its workstation kept where it holds work. Answered with the card. */
export class Stop extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/stop';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'stop' });
    return { card: project.board.card(cardId)! };
  };
}
