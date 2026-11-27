import { HttpRoute, type RouteRequest } from '../../../../httpRoute';

/** The owner removes the arrow they drew from the card to `:toCardId`. */
export class Dependency extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/dependencies/:toCardId';

  override DELETE = (request: RouteRequest): void => {
    this.getProjectRuntimeForCard(request).board.connect(request.params.cardId!, request.params.toCardId!, true);
  };
}
