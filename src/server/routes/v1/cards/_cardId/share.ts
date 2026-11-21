/**
 * The share of a card's demo: its page for colleagues on its project's demo site. `PATCH` sets
 * "Share on approval" (`{ onApproval }`) and answers with the card as its project shows it.
 */
import type { Item } from '../../../../../core/types';
import { BadRequest } from '../../../../board';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

export class Share extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/share';

  override PATCH = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = this.projectOfCard(request);
    const { onApproval } = ((await request.json()) ?? {}) as { onApproval?: unknown };
    if (typeof onApproval !== 'boolean') throw new BadRequest('invalid', 'onApproval must be true or false');
    return { card: project.setShareOnApproval(request.params.cardId!, onApproval) };
  };
}
