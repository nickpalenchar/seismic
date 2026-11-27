import { BadRequest } from '../../../../board';
import type { AgentSetting, Item } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner starts a code review of the card's work (`agent`: the one that reviews). Answered with the card. */
export class CodeReview extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/code-review';

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const { agent } = await this.bodyOf(request);
    if (agent !== undefined && (typeof agent !== 'object' || agent === null || Array.isArray(agent))) throw new BadRequest('invalid', 'agent must be an agent setting');
    return this.runCardAction(request, agent === undefined ? { action: 'codeReview' } : { action: 'codeReview', agent: agent as AgentSetting });
  };
}
