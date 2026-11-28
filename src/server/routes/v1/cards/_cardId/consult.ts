import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner asks Seismic about the plan: `text`, and `spoken`, `images` and `replyTo` (an exchange's part) as for a message. Answered with the card. */
export class Consult extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/consult';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (typeof body.text !== 'string') throw new BadRequest('invalid', 'text must be a string');
    return { card: await this.cardService.performAction(request.params.cardId!, { ...body, action: 'consult' } as CardAction) };
  };
}
