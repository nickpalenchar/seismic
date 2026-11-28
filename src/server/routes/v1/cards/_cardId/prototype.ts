import { BadRequest } from '../../../../board';
import type { CardAction, Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteDependencies, type RouteRequest } from '../../../httpRoute';

/** The owner has prototypes of the idea made (`text`: what to try, `variants`: the approaches planned). Answered with the card. */
export class Prototype extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/prototype';

  constructor(dependencies: RouteDependencies, private readonly cardService: CardService) {
    super(dependencies);
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (body.text !== undefined && typeof body.text !== 'string') throw new BadRequest('invalid', 'text must be text');
    return { card: await this.cardService.performAction(request.params.cardId!, { ...body, action: 'prototype' } as CardAction) };
  };
}
