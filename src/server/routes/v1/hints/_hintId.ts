import { HttpRoute, type RouteRequest } from '../../httpRoute';

/** The owner has seen the hint `:hintId` (a `HINT_REGISTRY` id); an unregistered one is refused. */
export class HintSeen extends HttpRoute {
  readonly path = '/api/v1/hints/:hintId';

  override PUT = (request: RouteRequest): { seen: string } => {
    const id = request.params.hintId!;
    this.dependencies.hints.markHintSeen(id);
    return { seen: id };
  };
}
