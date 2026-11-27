import { BadRequest } from '../../../../board';
import type { AgentSetting, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner hands the card's work to another agent (`agent`: the harness, model and effort). Answered with the card. */
export class HandOff extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/hand-off';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const { agent } = await this.bodyOf(request);
    if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) throw new BadRequest('invalid', 'agent must be an agent setting');
    return this.runCardAction(request, { action: 'handOff', agent: agent as AgentSetting });
  };
}
