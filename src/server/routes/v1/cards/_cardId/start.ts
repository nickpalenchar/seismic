import { BadRequest } from '../../../../board';
import type { AgentSetting, Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/**
 * The owner starts the card: Seismic judges when its agent can begin (`agent`: the harness, model
 * and effort picked for it); a plan, all its planned workstreams. `skipWaitForCards`: "Start anyway"
 * on a card waiting behind other cards (possible merge conflicts, the cards the owner connected it
 * to); it may still wait for a free workstation. Answered with the card once the start is taken in.
 */
export class Start extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/start';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const project = await this.cardService.getProjectRuntimeForCard(request.params.cardId!);
    const { agent, skipWaitForCards } = await this.bodyOf(request);
    if (skipWaitForCards !== undefined && typeof skipWaitForCards !== 'boolean') throw new BadRequest('invalid', 'skipWaitForCards must be true or false');
    const cardId = request.params.cardId!;
    const chosen = agent === undefined ? {} : { agent: agent as AgentSetting };
    await project.press(cardId, skipWaitForCards ? { action: 'force', ...chosen } : { action: 'start', ...chosen });
    return { card: project.board.card(cardId)! };
  };
}
