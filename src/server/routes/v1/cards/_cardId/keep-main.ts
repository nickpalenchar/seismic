import type { Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner takes a push to main back (its undo) while it can still be. Answered with the card. */
export class KeepMain extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/keep-main';

  override POST = (request: RouteRequest): Promise<{ card: Item }> => this.runCardAction(request, { action: 'keepMain' });
}
