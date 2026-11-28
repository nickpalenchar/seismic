import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/**
 * The owner answers the question the card waits on. `text`, and `picks` (the options chosen),
 * `spoken` (said aloud), `images`, `replyTo` and `spot` as for a message. Answered with the card
 * as it then stands.
 */
export class Answer extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/answer';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const body = await this.bodyOf(request);
    if (typeof body.text !== 'string') throw new BadRequest('invalid', 'text must be a string');
    const cardId = request.params.cardId!;
    await project.press(cardId, { ...body, action: 'answer' } as CardAction);
    return { card: project.board.card(cardId)! };
  };
}
