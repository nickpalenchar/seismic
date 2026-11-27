import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The cards (`{ cards }`) go into the group, which holds cards of its own canvas only. */
export class GroupCards extends HttpRoute {
  readonly path = '/api/v1/groups/:groupId/cards';

  override POST = async (request: RouteRequest): Promise<void> => {
    const project = this.projectOfGroup(request);
    project.board.group((await this.bodyOf(request)).cards, request.params.groupId!);
  };
}
