import { BadRequest } from '../../../board';
import type { CardPatch, Item } from '../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../httpRoute';

/**
 * A card: what the owner changes on it (its title, text, place, labels, a plan's fold), answered with
 * the card; and the card deleted, answered with nothing (its undo brings it back, `restore`).
 */
export class Card extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId';

  override PATCH = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = this.getProjectRuntimeForCard(request);
    const patch = (await request.json()) as unknown;
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new BadRequest('invalid', 'the changes must be an object');
    const cardId = request.params.cardId!;
    project.patch(cardId, patch as CardPatch);
    const card = project.board.item(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    return { card };
  };

  override DELETE = (request: RouteRequest): void => {
    const project = this.getProjectRuntimeForCard(request);
    project.remove(request.params.cardId!);
    
    project.koordinator.noticed();
  };
}
