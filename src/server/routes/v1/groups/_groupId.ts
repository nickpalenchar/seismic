import type { Group } from '../../../../core/types';
import type { ProjectService } from '../../../services/projectService';
import { HttpRoute, type RouteRequest } from '../../httpRoute';

/** One group: `PATCH` renames it (`{ name }`); `DELETE` ends it and answers with what brings it back. */
export class GroupById extends HttpRoute {
  readonly path = '/api/v1/groups/:groupId';

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  override PATCH = async (request: RouteRequest): Promise<void> => {
    const project = await this.projectService.getProjectRuntimeForGroup(request.params.groupId!);
    project.board.renameGroup(request.params.groupId!, (await this.bodyOf(request)).name);
  };

  override DELETE = async (request: RouteRequest): Promise<{ group: Group; cards: string[] }> =>
    (await this.projectService.getProjectRuntimeForGroup(request.params.groupId!)).board.deleteGroup(request.params.groupId!);
}
