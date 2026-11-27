import type { Canvas } from '../../../core/types';
import { HttpRoute, type RouteRequest } from '../httpRoute';

/** A new canvas on a project (`{ project, name, icon? }`), last in its order, answered with the canvas. */
export class Canvases extends HttpRoute {
  readonly path = '/api/v1/canvases';

  override POST = async (request: RouteRequest): Promise<{ canvas: Canvas }> => {
    const { project, name, icon } = await this.bodyOf(request);
    return { canvas: this.projectOfId(typeof project === 'string' ? project : null).board.createCanvas(name, icon) };
  };
}
