import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/**
 * The owner writes to the card: its agent (or the Question card's thread, or a review card's
 * decisions on its findings) gets the words. `text`, and `spoken` (said aloud), `images`, `replyTo`
 * (the exchange answered), `spot` (what the owner pointed at), `findings` and `findingNotes` (a
 * review card), `newAgent` (the agent a review goes on with). Answered with the card as it then stands.
 */
export class Message extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/message';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.getProjectRuntimeForCard(request);
    const body = await this.bodyOf(request);
    if (typeof body.text !== 'string') throw new BadRequest('invalid', 'text must be a string');
    const cardId = request.params.cardId!;
    await project.press(cardId, { ...body, action: 'message' } as CardAction);
    return { card: project.board.card(cardId)! };
  };
}
