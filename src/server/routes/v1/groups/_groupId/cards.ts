import type { ProjectService } from '../../../../services/projectService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The cards (`{ cards }`) go into the group, which holds cards of its own canvas only. */
export class GroupCards extends HttpRoute {
  readonly path = '/api/v1/groups/:groupId/cards';

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<void> => {
    const project = await this.projectService.getProjectRuntimeForGroup(request.params.groupId!);
    project.board.group((await this.bodyOf(request)).cards, request.params.groupId!);
  };
}
