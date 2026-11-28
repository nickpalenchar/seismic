import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner builds on a prototype (`workstream`: the one chosen). Answered with the card. */
export class BuildPrototype extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/build-prototype';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (body.workstream !== undefined && typeof body.workstream !== 'string') throw new BadRequest('invalid', 'workstream must be text');
    return { card: await this.cardService.performAction(request.params.cardId!, { ...body, action: 'buildPrototype' } as CardAction) };
  };
}
