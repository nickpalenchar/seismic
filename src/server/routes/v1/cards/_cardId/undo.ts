import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner discards the changes the card's worker made in the project's folder: what can be put back is, and the card's log says what was not. Answered with the card. */
export class Undo extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/undo';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'undo' });
}
