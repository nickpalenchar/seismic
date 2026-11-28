import type { HintsService } from '../../../services/hintsService';
import { HttpRoute, type RouteRequest } from '../../httpRoute';

/** The owner has seen the hint `:hintId` (a `HINT_REGISTRY` id); an unregistered one is refused. */
export class HintSeen extends HttpRoute {
  readonly path = '/api/v1/hints/:hintId';

  constructor(private readonly hintsService: HintsService) {
    super();
  }

  override PUT = async (request: RouteRequest): Promise<{ seen: string }> => {
    const id = request.params.hintId!;
    await this.hintsService.markHintSeen(id);
    return { seen: id };
  };
}
