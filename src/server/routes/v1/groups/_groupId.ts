import type { Group } from '../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../httpRoute';

/** One group: `PATCH` renames it (`{ name }`); `DELETE` ends it and answers with what brings it back. */
export class GroupById extends HttpRoute {
  readonly path = '/api/v1/groups/:groupId';

  override PATCH = async (request: RouteRequest): Promise<void> => {
    const project = this.projectOfGroup(request);
    project.board.renameGroup(request.params.groupId!, (await this.bodyOf(request)).name);
  };

  override DELETE = (request: RouteRequest): { group: Group; cards: string[] } =>
    this.projectOfGroup(request).board.deleteGroup(request.params.groupId!);
}
