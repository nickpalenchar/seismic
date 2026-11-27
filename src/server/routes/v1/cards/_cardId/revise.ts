import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner asks for the proposal to be reworked: `text`, and `spoken`, `images` and `replyTo` as for a message. Answered with the card. */
export class Revise extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/revise';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (typeof body.text !== 'string') throw new BadRequest('invalid', 'text must be a string');
    return this.runCardAction(request, { ...body, action: 'revise' } as CardAction);
  };
}
