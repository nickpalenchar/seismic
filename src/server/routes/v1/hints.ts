import { HttpRoute } from '../httpRoute';

/** The hints the owner has seen, as the page loads them once; DELETE brings every hint back. */
export class HintsRoute extends HttpRoute {
  readonly path = '/api/v1/hints';

  override GET = (): { hints: string[] } => ({ hints: this.dependencies.hints.getSeenHints() });

  override DELETE = (): { reset: number } => ({ reset: this.dependencies.hints.resetHints() });
}
