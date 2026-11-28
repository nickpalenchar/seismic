



import type { CardAction, Item } from '../../../../../core/types';
import { BadRequest } from '../../../../board';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/**
 * The card's demo page. `PATCH` sets "Share on approval"; `POST` shares a demo now (`demo`: its number, `add`:
 * beside the ones shared); `DELETE` stops sharing it (`demo`: only that one). Each answers with the card.
 */
export class Share extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/share';

  override PATCH = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.getProjectRuntimeForCard(request);
    const { onApproval } = ((await request.json()) ?? {}) as { onApproval?: unknown };
    if (typeof onApproval !== 'boolean') throw new BadRequest('invalid', 'onApproval must be true or false');
    return { card: project.setShareOnApproval(request.params.cardId!, onApproval) };
  };
  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const { demo, add } = await this.bodyOf(request);
    if (demo !== undefined && !Number.isInteger(demo)) throw new BadRequest('invalid', 'demo must be a demo number');
    if (add !== undefined && typeof add !== 'boolean') throw new BadRequest('invalid', 'add must be true or false');
    return this.runCardAction(request, { action: 'share', ...(demo === undefined ? {} : { demo: demo as number }), ...(add ? { add } : {}) } as CardAction);
  };

  override DELETE = async (request: RouteRequest): Promise<{ card: Item }> => {
    const { demo } = await this.bodyOf(request);
    if (demo !== undefined && !Number.isInteger(demo)) throw new BadRequest('invalid', 'demo must be a demo number');
    return this.runCardAction(request, { action: 'unshare', ...(demo === undefined ? {} : { demo: demo as number }) });
  };
}
