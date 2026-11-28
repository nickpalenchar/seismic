import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner lets the paused agent of the card go on, or the card that hit its retry limit try again. Answered with the card. */
export class Resume extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/resume';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'resume' });
    return { card: project.board.card(cardId)! };
  };
}
