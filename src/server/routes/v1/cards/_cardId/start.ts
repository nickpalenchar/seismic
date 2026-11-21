import type { AgentSetting, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/**
 * The owner starts the card: Seismic judges when its agent can begin (`agent`: the harness, model
 * and effort picked for it); a plan, all its planned workstreams. Answered with the card once the
 * start is taken in, which shows it queued.
 */
export class Start extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/start';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = this.projectOfCard(request);
    const { agent } = await this.bodyOf(request);
    const cardId = request.params.cardId!;
    await project.press(cardId, { action: 'start', ...(agent === undefined ? {} : { agent: agent as AgentSetting }) });
    return { card: project.board.card(cardId)! };
  };
}
