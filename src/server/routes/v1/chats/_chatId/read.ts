import { BadRequest } from '../../../../board';
import type { ProjectService } from '../../../../services/projectService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner saw the chat's answers: all of them, or (`{ ids }`) those exchanges. */
export class Read extends HttpRoute {
  readonly path = '/api/v1/chats/:chatId/read';

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ chat: number }> => {
    const { project, chat } = await this.projectService.getProjectRuntimeForChat(request.params.chatId!);
    const { ids } = await this.bodyOf(request);
    if (ids !== undefined && !(Array.isArray(ids) && ids.every((id) => Number.isInteger(id)))) throw new BadRequest('invalid', 'ids must be a list of exchange ids');
    project.board.readChat(chat, ids as number[] | undefined);
    return { chat };
  };
}
