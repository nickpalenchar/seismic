import type { ProjectService } from '../../../../services/projectService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The cards (`{ cards }`) go onto the canvas, each at a free spot there. */
export class CanvasCards extends HttpRoute {
  readonly path = '/api/v1/canvases/:canvasId/cards';

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<void> => {
    const project = await this.projectService.getProjectRuntimeForCanvas(request.params.canvasId!);
    project.board.moveToCanvas((await this.bodyOf(request)).cards, request.params.canvasId!);
  };
}
