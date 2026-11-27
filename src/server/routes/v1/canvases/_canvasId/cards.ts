import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The cards (`{ cards }`) go onto the canvas, each at a free spot there. */
export class CanvasCards extends HttpRoute {
  readonly path = '/api/v1/canvases/:canvasId/cards';

  override POST = async (request: RouteRequest): Promise<void> => {
    const project = this.projectOfCanvas(request);
    project.board.moveToCanvas((await this.bodyOf(request)).cards, request.params.canvasId!);
  };
}
