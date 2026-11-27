import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/**
 * The owner answers the question the card waits on. `text`, and `picks` (the options chosen),
 * `spoken` (said aloud), `images`, `replyTo` and `spot` as for a message. Answered with the card
 * as it then stands.
 */
export class Answer extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/answer';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = this.getProjectRuntimeForCard(request);
    const body = await this.bodyOf(request);
    if (typeof body.text !== 'string') throw new BadRequest('invalid', 'text must be a string');
    const cardId = request.params.cardId!;
    await project.press(cardId, { ...body, action: 'answer' } as CardAction);
    return { card: this.dependencies.cards.getCard(cardId)! };
  };
}
