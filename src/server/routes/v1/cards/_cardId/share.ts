



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
