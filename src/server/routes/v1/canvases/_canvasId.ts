import type { Canvas } from '../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../httpRoute';

/**
 * One canvas: `PATCH` renames it, changes its icon or moves it in the order (`{ name?, icon?, position? }`),
 * answered with the canvas; `DELETE` removes it (`{ expected, moveTo? }`: what it holds, and where that goes).
 */
export class CanvasById extends HttpRoute {
  readonly path = '/api/v1/canvases/:canvasId';

  override PATCH = async (request: RouteRequest): Promise<{ canvas: Canvas }> => {
    const project = this.projectOfCanvas(request);
    return { canvas: project.board.updateCanvas(request.params.canvasId!, await this.bodyOf(request)) };
  };

  override DELETE = async (request: RouteRequest): Promise<void> => {
    const project = this.projectOfCanvas(request);
    const { moveTo, expected } = (await this.bodyOf(request)) as { moveTo?: unknown; expected?: { parked?: unknown; snoozed?: unknown } };
    project.board.deleteCanvas(request.params.canvasId!, moveTo, expected);
  };
}
