import type { HintsService } from '../../services/hintsService';
import { HttpRoute } from '../httpRoute';

/** The hints the owner has seen, as the page loads them once; DELETE brings every hint back. */
export class HintsRoute extends HttpRoute {
  readonly path = '/api/v1/hints';

  constructor(private readonly hintsService: HintsService) {
    super();
  }

  override GET = async (): Promise<{ hints: string[] }> => ({ hints: await this.hintsService.getSeenHints() });

  override DELETE = async (): Promise<{ reset: number }> => ({ reset: await this.hintsService.resetHints() });
}
