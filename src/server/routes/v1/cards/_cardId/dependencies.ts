import type { ManualAnchor } from '../../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner draws an arrow from the card to another (`{ to, anchor? }`: the edges and place it was drawn at). */
export class Dependencies extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/dependencies';

  override POST = async (request: RouteRequest): Promise<void> => {
    const project = await this.getProjectRuntimeForCard(request);
    const { to, anchor } = await this.bodyOf(request);
    project.board.connect(request.params.cardId!, String(to), false, anchor as ManualAnchor | undefined);
  };
}
